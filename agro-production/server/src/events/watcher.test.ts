import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted provides variables visible to both vi.mock factories and
// test body without hoisting issues.
// ---------------------------------------------------------------------------
const {
  mockEventCursorFindUnique,
  mockEventCursorUpsert,
  mockTransactionCreate,
  mockGetEvents,
  mockGetLatestLedger,
} = vi.hoisted(() => ({
  mockEventCursorFindUnique: vi.fn().mockResolvedValue(null),
  mockEventCursorUpsert: vi.fn().mockResolvedValue({}),
  mockTransactionCreate: vi.fn().mockResolvedValue({}),
  mockGetEvents: vi.fn().mockResolvedValue({ events: [] }),
  mockGetLatestLedger: vi.fn().mockResolvedValue({ sequence: 500 }),
}));

vi.mock("../db/client.js", () => ({
  prisma: {
    eventCursor: {
      findUnique: mockEventCursorFindUnique,
      upsert: mockEventCursorUpsert,
    },
    transaction: {
      create: mockTransactionCreate,
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
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      getEvents: mockGetEvents,
      getLatestLedger: mockGetLatestLedger,
    })),
  },
}));

// ---------------------------------------------------------------------------
// After all mocks are declared we can import the module under test.
// ---------------------------------------------------------------------------
import { startProductionWatcher } from "./watcher.js";
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

      expect(logger.error).toHaveBeenCalledWith(
        "Production watcher poll error",
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

      // Should record dead-letter
      expect(mockTransactionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "dead_letter",
            status: "failed",
            ledger: 501,
          }),
        }),
      );

      // Cursor should NOT have advanced past the failed event
      expect(mockEventCursorUpsert).not.toHaveBeenCalled();
    });
  });
});
