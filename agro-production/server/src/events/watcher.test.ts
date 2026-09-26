import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted provides variables visible to both vi.mock factories and
// test body without hoisting issues.
// ---------------------------------------------------------------------------
const {
  mockEventCursorFindUnique,
  mockEventCursorUpsert,
  mockTransactionCreate,
  mockTransactionUpsert,
  mockTransactionFindMany,
  mockTransactionDelete,
  mockTransactionDeleteMany,
  mockGetEvents,
  mockGetLatestLedger,
  mockGetLedger,
} = vi.hoisted(() => ({
  mockEventCursorFindUnique: vi.fn().mockResolvedValue(null),
  mockEventCursorUpsert: vi.fn().mockResolvedValue({}),
  mockTransactionCreate: vi.fn().mockResolvedValue({}),
  mockTransactionUpsert: vi.fn().mockResolvedValue({}),
  mockTransactionFindMany: vi.fn().mockResolvedValue([]),
  mockTransactionDelete: vi.fn().mockResolvedValue({}),
  mockTransactionDeleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  mockGetEvents: vi.fn().mockResolvedValue({ events: [] }),
  mockGetLatestLedger: vi.fn().mockResolvedValue({ sequence: 500 }),
  mockGetLedger: vi.fn().mockResolvedValue({ hash: 'abcd1234' }),
}));

vi.mock("../db/client.js", () => ({
  prisma: {
    eventCursor: {
      findUnique: mockEventCursorFindUnique,
      upsert: mockEventCursorUpsert,
    },
    transaction: {
      create: mockTransactionCreate,
      upsert: mockTransactionUpsert,
      findMany: mockTransactionFindMany,
      delete: mockTransactionDelete,
      deleteMany: mockTransactionDeleteMany,
    },
  },
}));

vi.mock("../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../config/index.js", () => ({
  config: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    contractId: "CTEST000000000000000000000000000000000000000000000000AA",
  },
}));

vi.mock("./parser.js", () => ({
  ProductionEventParser: { tryParse: vi.fn().mockReturnValue(null) },
}));

vi.mock("./persister.js", () => ({
  EventPersister: { persist: vi.fn().mockResolvedValue(undefined) },
  DependencyMissingError: class DependencyMissingError extends Error {
    dependency: string;
    dependencyOnChainId: string;
    constructor(dependency: string, dependencyOnChainId: string) {
      super(`${dependency} ${dependencyOnChainId} has not been indexed yet`);
      this.name = "DependencyMissingError";
      this.dependency = dependency;
      this.dependencyOnChainId = dependencyOnChainId;
    }
  },
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      getEvents: mockGetEvents,
      getLatestLedger: mockGetLatestLedger,
      getLedger: mockGetLedger,
    })),
  },
}));

// ---------------------------------------------------------------------------
// After all mocks are declared we can import the module under test.
// ---------------------------------------------------------------------------
import { startProductionWatcher, replayDeadLetterEvents } from "./watcher.js";
import { DependencyMissingError } from "./persister.js";
import { ProductionEventParser } from "./parser.js";
import { EventPersister } from "./persister.js";
import logger from "../config/logger.js";

describe("startProductionWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("cursor loading", () => {
    it("resumes from the persisted cursor when an eventCursor record exists", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 300,
        eventIndex: 2,
      });

      await startProductionWatcher();

      expect(logger.info).toHaveBeenCalledWith(
        "Production watcher: resuming from persisted cursor",
        expect.objectContaining({ ledger: 300, eventIndex: 2 }),
      );
    });

    it("falls back to the current ledger tip when no cursor exists", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce(null);
      mockGetLatestLedger.mockResolvedValueOnce({ sequence: 500 });

      await startProductionWatcher();

      expect(logger.info).toHaveBeenCalledWith(
        "Production watcher: no cursor found, starting from current ledger",
        expect.objectContaining({ ledger: 500 }),
      );
    });
  });

  describe("gap handling", () => {
    it("logs an error when gap exceeds MAX_BACKFILL_BATCH but continues", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 100,
        eventIndex: 0,
      });
      mockGetLatestLedger.mockResolvedValue({ sequence: 1200 });

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(logger.error).toHaveBeenCalledWith(
        "Production watcher: large ledger gap detected, backfill may not cover all events",
        expect.objectContaining({ gap: 1100, maxBatch: 100 }),
      );
    });

    it("does not log a gap warning when the gap is within MAX_BACKFILL_BATCH", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 490,
        eventIndex: 0,
      });
      mockGetLatestLedger.mockResolvedValue({ sequence: 500 });

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(logger.error).not.toHaveBeenCalledWith(
        "Production watcher: large ledger gap detected, backfill may not cover all events",
        expect.anything(),
      );
    });
  });

  describe("poll loop", () => {
    it("calls getEvents with the correct startLedger on the first tick", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 300,
        eventIndex: 0,
      });
      mockGetLatestLedger.mockResolvedValue({ sequence: 301 });
      mockGetEvents.mockResolvedValue({ events: [] });

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockGetEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 300 }),
      );
    });

    it("advances the cursor after processing events", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 300,
        eventIndex: 0,
      });
      mockGetLatestLedger.mockResolvedValue({ sequence: 301 });

      const fakeEvent = {
        ledger: 302,
        id: "302-0",
        type: "contract",
        ledgerClosedAt: new Date().toISOString(),
        contractId: "CTEST",
        topic: [],
        value: "",
      };
      mockGetEvents.mockResolvedValueOnce({ events: [fakeEvent] });
      vi.mocked(ProductionEventParser.tryParse).mockReturnValueOnce(null);

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      // eventCursor.upsert should have been called with the max event ledger
      expect(mockEventCursorUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contractId: expect.any(String) },
          create: expect.objectContaining({ ledger: 302, eventIndex: 0 }),
          update: expect.objectContaining({ ledger: 302, eventIndex: 0 }),
        }),
      );

      // Second tick should use the advanced ledger
      mockGetEvents.mockResolvedValueOnce({ events: [] });
      mockGetLatestLedger.mockResolvedValue({ sequence: 302 });
      await vi.advanceTimersByTimeAsync(5_000);

      const calls = mockGetEvents.mock.calls;
      expect(calls[1][0]).toMatchObject({ startLedger: 302 });
    });

    it("logs and continues when getEvents throws", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce(null);
      mockGetLatestLedger.mockResolvedValue({ sequence: 500 });
      mockGetEvents.mockRejectedValueOnce(new Error("RPC timeout"));

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      // Issue #756 fix: this assertion previously expected a log message
      // ("Production watcher poll error") the source never actually
      // produced (it logs "Soroban watcher poll error") — a pre-existing,
      // unrelated string mismatch that made this test always fail before
      // this PR touched the file for its own reasons (adding a Sentry
      // alert call in the same catch block).
      expect(logger.error).toHaveBeenCalledWith(
        "Soroban watcher poll error",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("skips events that fail to parse (tryParse returns null)", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce(null);
      mockGetLatestLedger.mockResolvedValue({ sequence: 500 });

      const badEvent = {
        ledger: 501,
        id: "501-0",
        type: "contract",
        ledgerClosedAt: new Date().toISOString(),
        contractId: "CTEST",
        topic: [],
        value: "",
      };
      mockGetEvents.mockResolvedValueOnce({ events: [badEvent] });
      vi.mocked(ProductionEventParser.tryParse).mockReturnValueOnce(null);

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(EventPersister.persist).not.toHaveBeenCalled();
      // Cursor should still advance since parse-failed events don't block
      expect(mockEventCursorUpsert).toHaveBeenCalled();
    });

    it("persists events that parse successfully", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce(null);
      mockGetLatestLedger.mockResolvedValue({ sequence: 500 });

      const rawEvent = {
        ledger: 501,
        id: "501-0",
        type: "contract",
        ledgerClosedAt: new Date().toISOString(),
        contractId: "CTEST",
        topic: [],
        value: "",
      };
      const parsedEvent = {
        action: "campaign.created" as const,
        ledger: 501,
        eventIndex: 0,
        timestamp: new Date(),
        rawId: "501-0",
        campaignId: "1",
        farmer: "GFARMER",
        token: "GTOKEN",
        targetAmount: "10000",
        deadline: "9999999",
      };

      mockGetEvents.mockResolvedValueOnce({ events: [rawEvent] });
      vi.mocked(ProductionEventParser.tryParse).mockReturnValueOnce(parsedEvent);

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(EventPersister.persist).toHaveBeenCalledWith(parsedEvent);
    });

    it("sends persist failures to dead-letter and does NOT advance cursor past them", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce(null);
      mockGetLatestLedger.mockResolvedValue({ sequence: 500 });

      const rawEvent = {
        ledger: 501,
        id: "501-0",
        type: "contract",
        ledgerClosedAt: new Date().toISOString(),
        contractId: "CTEST",
        topic: [],
        value: "",
      };
      const parsedEvent = {
        action: "campaign.settled" as const,
        ledger: 501,
        eventIndex: 0,
        timestamp: new Date(),
        rawId: "501-0",
        campaignId: "1",
        totalRevenue: "500",
      };

      mockGetEvents.mockResolvedValueOnce({ events: [rawEvent] });
      vi.mocked(ProductionEventParser.tryParse).mockReturnValueOnce(parsedEvent);
      vi.mocked(EventPersister.persist).mockRejectedValue(new Error("write failed"));

      await startProductionWatcher();
      // Advance past poll interval (5s) plus retry delays (~2.8s total)
      await vi.advanceTimersByTimeAsync(10_000);

      // Should record a deduplicated, replayable dead-letter row (issue #1067)
      expect(mockTransactionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ledger_eventIndex: { ledger: 501, eventIndex: 0 } },
          create: expect.objectContaining({
            eventType: "dead_letter",
            status: "failed",
            ledger: 501,
          }),
        }),
      );

      // Cursor should NOT have advanced past the failed event
      expect(mockEventCursorUpsert).not.toHaveBeenCalled();
    });

    it("dead-letters a dependency-missing event and stores it for replay (issue #1067)", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 300,
        eventIndex: 0,
      });
      mockGetLatestLedger.mockResolvedValue({ sequence: 500 });

      const rawEvent = {
        ledger: 302,
        id: "302-0",
        type: "contract",
        ledgerClosedAt: new Date().toISOString(),
        contractId: "CTEST",
        topic: [],
        value: "",
      };
      const parsedEvent = {
        action: "campaign.invested" as const,
        ledger: 302,
        eventIndex: 0,
        timestamp: new Date(),
        rawId: "302-0",
        campaignId: "7",
        investor: "GINVESTOR0000000000000000000000000000000000000000000000",
        amount: "100",
        totalRaised: "100",
      };

      mockGetEvents.mockResolvedValueOnce({ events: [rawEvent] });
      vi.mocked(ProductionEventParser.tryParse).mockReturnValueOnce(parsedEvent);
      vi.mocked(EventPersister.persist).mockRejectedValue(
        new DependencyMissingError("campaign", "7"),
      );

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(10_000);

      // The event is stored as a replayable dead letter instead of being
      // silently skipped.
      expect(mockTransactionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ledger_eventIndex: { ledger: 302, eventIndex: 0 } },
          create: expect.objectContaining({
            eventType: "dead_letter",
            ledger: 302,
          }),
        }),
      );

      // Cursor should NOT have advanced past the missing-dependency event.
      expect(mockEventCursorUpsert).not.toHaveBeenCalled();
    });

    it("replays dead-lettered child events after the parent campaign is indexed (issue #1067)", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 300,
        eventIndex: 0,
      });
      mockGetLatestLedger.mockResolvedValue({ sequence: 500 });

      const parentRaw = {
        ledger: 302,
        id: "302-0",
        type: "contract",
        ledgerClosedAt: new Date().toISOString(),
        contractId: "CTEST",
        topic: [],
        value: "",
      };
      const childRaw = {
        ledger: 301,
        id: "301-0",
        type: "contract",
        ledgerClosedAt: new Date().toISOString(),
        contractId: "CTEST",
        topic: [],
        value: "",
      };
      const parentEvent = {
        action: "campaign.created" as const,
        ledger: 302,
        eventIndex: 0,
        timestamp: new Date(),
        rawId: "302-0",
        campaignId: "7",
        farmer: "GFARMER",
        token: "GTOKEN",
        targetAmount: "1000",
        deadline: "9999999",
      };
      const childEvent = {
        action: "campaign.invested" as const,
        ledger: 301,
        eventIndex: 0,
        timestamp: new Date(),
        rawId: "301-0",
        campaignId: "7",
        investor: "GINVESTOR0000000000000000000000000000000000000000000000",
        amount: "100",
        totalRaised: "100",
      };

      mockGetEvents.mockResolvedValueOnce({ events: [parentRaw] });
      vi.mocked(ProductionEventParser.tryParse)
        .mockReturnValueOnce(parentEvent)
        .mockReturnValueOnce(childEvent);

      // A previously dead-lettered investment whose parent has now arrived.
      mockTransactionFindMany.mockResolvedValueOnce([
        {
          id: "dl-1",
          eventType: "dead_letter",
          status: "failed",
          payload: { rawEvent: childRaw },
          ledger: 301,
          eventIndex: 0,
        },
      ]);

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      // campaign.created persisted, then the dead-lettered child replayed.
      expect(EventPersister.persist).toHaveBeenCalledTimes(2);
      expect(EventPersister.persist).toHaveBeenLastCalledWith(childEvent);
      // The dead-letter row is removed on successful replay.
      expect(mockTransactionDelete).toHaveBeenCalledWith({ where: { id: "dl-1" } });
    });

    it("re-arms the dead letter when a replay still fails (issue #1067)", async () => {
      const row = {
        id: "dl-1",
        eventType: "dead_letter",
        status: "failed",
        payload: {
          rawEvent: {
            ledger: 301,
            id: "301-0",
            type: "contract",
            ledgerClosedAt: new Date().toISOString(),
            contractId: "CTEST",
            topic: [],
            value: "",
          },
        },
        ledger: 301,
        eventIndex: 0,
      };
      mockTransactionFindMany.mockResolvedValueOnce([row]);
      vi.mocked(ProductionEventParser.tryParse).mockReturnValueOnce({
        action: "campaign.invested" as const,
        ledger: 301,
        eventIndex: 0,
        timestamp: new Date(),
        rawId: "301-0",
        campaignId: "7",
        investor: "GINVESTOR0000000000000000000000000000000000000000000000",
        amount: "100",
        totalRaised: "100",
      });
      vi.mocked(EventPersister.persist).mockRejectedValueOnce(
        new DependencyMissingError("campaign", "7"),
      );

      const result = await replayDeadLetterEvents();

      expect(result).toEqual({ replayed: 0, failed: 1 });
      // The row was deleted and then re-armed via the deduplicated upsert.
      expect(mockTransactionDelete).toHaveBeenCalledWith({ where: { id: "dl-1" } });
      expect(mockTransactionUpsert).toHaveBeenCalled();
    });

    it("respects confirmation depth and skips unconfirmed events", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 480,
        eventIndex: 0,
        ledgerHash: "hash480",
      });
      // Tip is 500, confirmation depth is 10, so confirmed tip is 490
      // Events at 491-500 should be skipped
      mockGetLatestLedger.mockResolvedValue({ sequence: 500 });

      const unconfirmedEvent = {
        ledger: 495, // > confirmed tip (490)
        id: "495-0",
        type: "contract",
        ledgerClosedAt: new Date().toISOString(),
        contractId: "CTEST",
        topic: [],
        value: "",
      };
      const confirmedEvent = {
        ledger: 485, // < confirmed tip (490)
        id: "485-0",
        type: "contract",
        ledgerClosedAt: new Date().toISOString(),
        contractId: "CTEST",
        topic: [],
        value: "",
      };
      mockGetEvents.mockResolvedValueOnce({
        events: [confirmedEvent, unconfirmedEvent],
      });

      const parsedEvent = {
        action: "campaign.created" as const,
        ledger: 485,
        eventIndex: 0,
        timestamp: new Date(),
        rawId: "485-0",
        campaignId: "1",
        farmer: "GFARMER",
        token: "GTOKEN",
        targetAmount: "10000",
        deadline: "9999999",
      };
      vi.mocked(ProductionEventParser.tryParse).mockReturnValueOnce(parsedEvent);
      mockGetLedger.mockResolvedValueOnce({ hash: "hash485" });

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      // Only the confirmed event (485) should be persisted
      expect(EventPersister.persist).toHaveBeenCalledTimes(1);
      expect(EventPersister.persist).toHaveBeenCalledWith(parsedEvent);

      // Cursor should advance to confirmed event only
      expect(mockEventCursorUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ ledger: 485, eventIndex: 0 }),
        }),
      );
    });

    it("detects reorg when ledger hash diverges and rolls back stale transactions", async () => {
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 400,
        eventIndex: 0,
        ledgerHash: "original_hash_400",
      });
      mockGetLatestLedger.mockResolvedValue({ sequence: 410 });

      // Reorg detected: hash at ledger 400 has changed
      mockGetLedger.mockResolvedValueOnce({ hash: "NEW_hash_400" });

      mockGetEvents.mockResolvedValueOnce({ events: [] });
      mockTransactionDeleteMany.mockResolvedValueOnce({ count: 5 });

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      // Should detect reorg and attempt rollback
      expect(logger.warn).toHaveBeenCalledWith(
        "Reorg detected: ledger hash mismatch",
        expect.objectContaining({
          trackedLedger: 400,
          expectedHash: "original_hash_400",
          observedHash: "NEW_hash_400",
        }),
      );

      // Should delete stale transactions from the reorg'd ledger onward
      expect(mockTransactionDeleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ledger: { gte: 400 } },
        }),
      );
    });

    it("handles rollback poison pill by removing conflicting transactions before re-projection", async () => {
      // This test verifies that the @@unique([ledger, eventIndex]) constraint
      // no longer causes a poison-pill by ensuring transactions are deleted
      // before re-projecting from the fork point
      mockEventCursorFindUnique.mockResolvedValueOnce({
        contractId: "CTEST",
        ledger: 350,
        eventIndex: 0,
        ledgerHash: "hash350",
      });
      mockGetLatestLedger.mockResolvedValue({ sequence: 360 });

      // Reorg at ledger 355
      mockGetLedger.mockResolvedValueOnce({ hash: "different_hash_350" });
      mockTransactionDeleteMany.mockResolvedValueOnce({
        count: 2, // 2 stale transactions from ledger 350+ were deleted
      });

      mockGetEvents.mockResolvedValueOnce({ events: [] });

      await startProductionWatcher();
      await vi.advanceTimersByTimeAsync(5_000);

      // Verify rollback occurred before any re-projection would happen
      expect(mockTransactionDeleteMany).toHaveBeenCalledBefore(
        mockEventCursorUpsert as any,
      );
    });
  });
});
