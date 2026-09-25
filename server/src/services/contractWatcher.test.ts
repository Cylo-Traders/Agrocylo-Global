import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: { Server: vi.fn() },
  scValToNative: vi.fn(),
  xdr: { ScVal: { fromXDR: vi.fn() } },
}));
vi.mock("../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../config/index.js", () => ({
  config: {
    contractId: "test-contract",
    rpcUrl: "https://testnet.local",
    wsPath: "/ws",
  },
}));
vi.mock("../config/database.js", () => ({
  prisma: {
    contractWatcherCheckpoint: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));
vi.mock("./notificationService.js", () => ({
  NotificationService: { notify: vi.fn(), notifyFromEscrowEvent: vi.fn(), notifyOrderEvent: vi.fn() },
}));
vi.mock("./wsManager.js", () => ({
  // Issue #756 fix: this mock predated `dispatchEvent`'s use of
  // `broadcastAuthenticated` (added separately from this PR) and was never
  // updated, so every `dispatchEvent` test calling it failed with
  // "not a function" regardless of anything this PR touches.
  wsManager: { broadcast: vi.fn(), broadcastTo: vi.fn(), broadcastAuthenticated: vi.fn(), clientCount: 0 },
}));
vi.mock("./events/blockchainEventIngestionService.js", () => ({
  BlockchainEventIngestionService: { ingestEvent: vi.fn() },
}));
vi.mock("./events/escrowEventIngestionService.js", () => ({
  EscrowEventIngestionService: { ingestEvent: vi.fn() },
}));
vi.mock("../config/sentry.js", () => ({
  captureAlert: vi.fn(),
}));

import { detectRecoveryGap, loadCheckpoint, persistCheckpoint, dispatchEvent, fetchEventsPaginated, MAX_LEDGER_SPAN } from "./contractWatcher.js";
import { prisma } from "../config/database.js";
import logger from "../config/logger.js";
import { NotificationService } from "./notificationService.js";
import { wsManager } from "./wsManager.js";
import { contractWatcherUnhandledTotal } from "./promMetrics.js";
import { captureAlert } from "../config/sentry.js";

const notifyFromEscrowEvent = vi.mocked(NotificationService.notifyFromEscrowEvent);
const notify = vi.mocked(NotificationService.notify);
// Issue #756 fix: `dispatchEvent` broadcasts via `broadcastAuthenticated`
// (added in an unrelated, prior change), but this was still pointed at the
// old `broadcast` method, failing every test below with "not a function"
// before this PR touched the file for its own, unrelated reasons.
const broadcast = vi.mocked(wsManager.broadcastAuthenticated);

describe("contractWatcher", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("dispatchEvent", () => {
    it("notifies escrow and broadcasts on 'created'", () => {
      dispatchEvent("created", ["order-1", "BUYER", "FARMER", "100", "USDC"], 500);

      expect(notifyFromEscrowEvent).toHaveBeenCalledWith({
        action: "created",
        buyerAddress: "BUYER",
        farmerAddress: "FARMER",
        orderId: "order-1",
        amount: "100",
        token: "USDC",
      });
      expect(broadcast).toHaveBeenCalledWith("order:created", {
        orderId: "order-1",
        buyer: "BUYER",
        farmer: "FARMER",
        amount: "100",
        token: "USDC",
      });
    });

    it("only broadcasts on 'delivered' (no notification)", () => {
      dispatchEvent("delivered", ["order-2", "FARMER", "BUYER"], 501);

      expect(notifyFromEscrowEvent).not.toHaveBeenCalled();
      expect(broadcast).toHaveBeenCalledWith("order:delivered", {
        orderId: "order-2",
        farmer: "FARMER",
        buyer: "BUYER",
      });
    });

    it("notifies escrow and broadcasts on 'confirmed'", () => {
      dispatchEvent("confirmed", ["order-3", "BUYER", "FARMER"], 502);

      expect(notifyFromEscrowEvent).toHaveBeenCalledWith({
        action: "confirmed",
        buyerAddress: "BUYER",
        farmerAddress: "FARMER",
        orderId: "order-3",
      });
      expect(broadcast).toHaveBeenCalledWith("order:confirmed", {
        orderId: "order-3",
        buyer: "BUYER",
        farmer: "FARMER",
      });
    });

    it("notifies escrow and broadcasts on 'refunded'", () => {
      dispatchEvent("refunded", ["order-4", "BUYER"], 503);

      expect(notifyFromEscrowEvent).toHaveBeenCalledWith({
        action: "refunded",
        buyerAddress: "BUYER",
        orderId: "order-4",
      });
      expect(broadcast).toHaveBeenCalledWith("order:refunded", {
        orderId: "order-4",
        buyer: "BUYER",
      });
    });

    it("logs a warning for an unknown action and does not broadcast", () => {
      dispatchEvent("unknown_action", ["order-5"], 504);

      expect(notifyFromEscrowEvent).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Unhandled event action"),
      );
    });

    it("handles cancelled event with notification + WS broadcast", () => {
      dispatchEvent("cancelled", ["order-10", "BUYER"], 600);
      expect(broadcast).toHaveBeenCalledWith("order:cancelled", expect.objectContaining({ orderId: "order-10" }));
      // notifyFromEscrowEvent is called via refund path
      expect(notifyFromEscrowEvent).toHaveBeenCalled();
    });

    it("handles disputed event with broadcast and notification", () => {
      dispatchEvent("disputed", ["order-11", "BUYER", "FARMER"], 601);
      expect(broadcast).toHaveBeenCalledWith("order:disputed", expect.objectContaining({ orderId: "order-11" }));
      expect(broadcast).toHaveBeenCalledWith("order:status_changed", expect.objectContaining({ status: "DISPUTED" }));
    });

    it("handles resolved event with broadcast", () => {
      dispatchEvent("resolved", ["order-12", "Release", "BUYER", "FARMER"], 602);
      expect(broadcast).toHaveBeenCalledWith("order:resolved", expect.objectContaining({ orderId: "order-12" }));
    });

    it("handles split:created with broadcast", () => {
      dispatchEvent("created", ["order-13", "FARMER", "TOKEN", "500"], 603, "split");
      expect(broadcast).toHaveBeenCalledWith("split:created", expect.objectContaining({ orderId: "order-13" }));
    });

    it("handles split:disputed and split:resolved with broadcast + notification", () => {
      dispatchEvent("disputed", ["order-14", "BUYER"], 604, "split");
      expect(broadcast).toHaveBeenCalledWith("split:disputed", expect.objectContaining({ orderId: "order-14" }));
      dispatchEvent("resolved", ["order-15", "Refund", "BUYER", "FARMER"], 605, "split");
      expect(broadcast).toHaveBeenCalledWith("split:resolved", expect.objectContaining({ orderId: "order-15" }));
    });

    it("handles order.splitnew (production split) as split family", () => {
      dispatchEvent("splitnew", ["order-16", "CAMPAIGN_1", "1000"], 606, "order");
      expect(broadcast).toHaveBeenCalledWith("order:splitnew", expect.objectContaining({ orderId: "order-16" }));
    });

    it("acknowledges campaign and basket events as indexed-only without unhandled metric", () => {
      const inc = vi.mocked(contractWatcherUnhandledTotal.inc);
      inc.mockClear();
      dispatchEvent("created", ["camp-1", "FARMER", "TOKEN", "1000", "123"], 700, "campaign");
      expect(inc).not.toHaveBeenCalled();
      expect(broadcast).toHaveBeenCalledWith("campaign:created", expect.any(Object));

      inc.mockClear();
      dispatchEvent("funded", ["basket-1", "100", "90", "10"], 701, "basket");
      expect(inc).not.toHaveBeenCalled();
      // basket events broadcast as basket:funded
      expect(broadcast).toHaveBeenCalledWith("basket:funded", expect.any(Object));
    });

    it("acknowledges paused/upgraded as indexed, no notification", () => {
      const inc = vi.mocked(contractWatcherUnhandledTotal.inc);
      inc.mockClear();
      dispatchEvent("paused", ["order-1", "ADMIN"], 702, "order");
      expect(inc).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalledWith("order:paused", expect.anything());
    });

    it("supports full topic string dispatch (entity.action)", () => {
      dispatchEvent("order.cancelled", ["order-20", "BUYER"], 710);
      expect(broadcast).toHaveBeenCalledWith("order:cancelled", expect.objectContaining({ orderId: "order-20" }));
    });

    it("increments unhandled metric + alert for unknown action", () => {
      const inc = vi.mocked(contractWatcherUnhandledTotal.inc);
      const alert = vi.mocked(captureAlert);
      inc.mockClear();
      alert.mockClear();
      dispatchEvent("unknown_action_xyz", ["order-5"], 504, "order");
      expect(inc).toHaveBeenCalledWith(expect.objectContaining({ action: "unknown_action_xyz", entity: "order" }));
      expect(alert).toHaveBeenCalledWith("contract_watcher_unhandled_event", expect.any(String), expect.objectContaining({ action: "unknown_action_xyz" }));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Unhandled event action"));
    });

    it("routes governance contract events to governance dispatcher", () => {
      // governance via entity
      dispatchEvent("proposed", ["prop-1", "PROPOSER", "TARGET", "FUNC"], 800, "governance");
      expect(broadcast).toHaveBeenCalledWith("governance:proposed", expect.objectContaining({ proposalId: "prop-1" }));
    });
  });

  describe("detectRecoveryGap", () => {
    it("should log fresh start when no checkpoint exists", () => {
      detectRecoveryGap(null, 500);

      expect(logger.info).toHaveBeenCalledWith(
        "[ContractWatcher] Fresh start — beginning from ledger 500",
      );
    });

    it("should log no gap when checkpoint is ahead of latest ledger", () => {
      detectRecoveryGap(600, 500);

      expect(logger.info).toHaveBeenCalledWith(
        "[ContractWatcher] Checkpoint is ahead of or at latest ledger (checkpoint: 600, latest: 500)",
      );
    });

    it("should log no gap when checkpoint equals latest ledger", () => {
      detectRecoveryGap(500, 500);

      expect(logger.info).toHaveBeenCalledWith(
        "[ContractWatcher] Checkpoint is ahead of or at latest ledger (checkpoint: 500, latest: 500)",
      );
    });

    it("should not warn for small gaps below threshold", () => {
      detectRecoveryGap(495, 500);

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should warn when gap exceeds recovery threshold", () => {
      detectRecoveryGap(400, 500);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Recovery gap detected: 100 ledgers behind"),
      );
    });

    it("should warn at the exact threshold boundary", () => {
      detectRecoveryGap(490, 500);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Recovery gap detected: 10 ledgers behind"),
      );
    });

    it("should not warn just below the threshold", () => {
      detectRecoveryGap(492, 500);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("loadCheckpoint", () => {
    it("should return ledger when checkpoint exists", async () => {
      (prisma.contractWatcherCheckpoint.findUnique as any).mockResolvedValue({
        service: "contract-watcher",
        lastLedger: 12345,
      });

      const result = await loadCheckpoint();

      expect(result).toBe(12345);
      expect(prisma.contractWatcherCheckpoint.findUnique).toHaveBeenCalledWith({
        where: { service: "contract-watcher" },
      });
      expect(logger.info).toHaveBeenCalledWith(
        "[ContractWatcher] Loaded checkpoint: ledger 12345",
      );
    });

    it("should return null when no checkpoint found", async () => {
      (prisma.contractWatcherCheckpoint.findUnique as any).mockResolvedValue(null);

      const result = await loadCheckpoint();

      expect(result).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        "[ContractWatcher] No existing checkpoint found",
      );
    });

    it("should return null on database error", async () => {
      (prisma.contractWatcherCheckpoint.findUnique as any).mockRejectedValue(
        new Error("DB connection lost"),
      );

      const result = await loadCheckpoint();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "[ContractWatcher] Failed to load checkpoint",
        expect.any(Error),
      );
    });
  });

  describe("persistCheckpoint", () => {
    it("should upsert checkpoint with the given ledger", async () => {
      await persistCheckpoint(99999);

      expect(prisma.contractWatcherCheckpoint.upsert).toHaveBeenCalledWith({
        where: { service: "contract-watcher" },
        create: { service: "contract-watcher", lastLedger: 99999 },
        update: { lastLedger: 99999 },
      });
      expect(logger.debug).toHaveBeenCalledWith(
        "[ContractWatcher] Persisted checkpoint: ledger 99999",
      );
    });

    it("should handle upsert errors gracefully", async () => {
      (prisma.contractWatcherCheckpoint.upsert as any).mockRejectedValue(
        new Error("Write conflict"),
      );

      await persistCheckpoint(500);

      expect(logger.error).toHaveBeenCalledWith(
        "[ContractWatcher] Failed to persist checkpoint",
        expect.any(Error),
      );
    });
  });

  describe("fetchEventsPaginated — pagination & checkpoint boundary", () => {
    it("pages through multi-page response and returns all events before advancing checkpoint", async () => {
      const mockGetEvents = vi
        .fn()
        .mockResolvedValueOnce({
          events: [
            { ledger: 10, contractId: "test-contract", topic: [], value: {}, transactionIndex: 0 },
            { ledger: 11, contractId: "test-contract", topic: [], value: {}, transactionIndex: 0 },
          ],
          cursor: "cursor-1",
        })
        .mockResolvedValueOnce({
          events: [{ ledger: 12, contractId: "test-contract", topic: [], value: {}, transactionIndex: 0 }],
          cursor: undefined,
        });
      const mockServer: any = { getEvents: mockGetEvents };

      const { events, pages, drained } = await fetchEventsPaginated(mockServer, 10, 100, ["test-contract"]);

      expect(mockGetEvents).toHaveBeenCalledTimes(2);
      expect(mockGetEvents).toHaveBeenNthCalledWith(1, expect.objectContaining({ startLedger: 10, cursor: undefined }));
      expect(mockGetEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "cursor-1" }));
      expect(events).toHaveLength(3);
      expect(pages).toBe(2);
      expect(drained).toBe(true);
      // All ledgers within span, checkpoint should advance to beyond max ledger
      expect(events.map((e: any) => e.ledger)).toEqual([10, 11, 12]);
    });

    it("bounds by max ledger span — events beyond span are not included but span still drains", async () => {
      const mockGetEvents = vi.fn().mockResolvedValue({
        events: [
          { ledger: 10, contractId: "test-contract", topic: [], value: {}, transactionIndex: 0 },
          { ledger: 150, contractId: "test-contract", topic: [], value: {}, transactionIndex: 0 },
        ],
        cursor: undefined,
      });
      const mockServer: any = { getEvents: mockGetEvents };

      // Span is 100 ledgers from 10 => endLedger 110; ledger 150 should be filtered out
      const { events, drained } = await fetchEventsPaginated(mockServer, 10, 110, ["test-contract"]);
      expect(events).toHaveLength(1);
      expect(events[0].ledger).toBe(10);
      expect(drained).toBe(true);
    });

    it("marks not drained when max pages exceeded", async () => {
      const mockGetEvents = vi.fn().mockResolvedValue({
        events: [{ ledger: 10, contractId: "test-contract", topic: [], value: {}, transactionIndex: 0 }],
        cursor: "next-cursor",
      });
      const mockServer: any = { getEvents: mockGetEvents };

      const { drained, pages } = await fetchEventsPaginated(mockServer, 10, 1000, ["test-contract"]);
      expect(drained).toBe(false);
      expect(pages).toBe(50); // MAX_PAGES_PER_POLL
    });

    it("handles empty page with cursor continuation", async () => {
      const mockGetEvents = vi
        .fn()
        .mockResolvedValueOnce({ events: [], cursor: "cursor-1" })
        .mockResolvedValueOnce({ events: [{ ledger: 10, contractId: "test-contract", topic: [], value: {}, transactionIndex: 0 }], cursor: undefined });
      const mockServer: any = { getEvents: mockGetEvents };
      const { events, pages } = await fetchEventsPaginated(mockServer, 10, 100, ["test-contract"]);
      expect(events).toHaveLength(1);
      expect(pages).toBe(2);
    });
  });
});
