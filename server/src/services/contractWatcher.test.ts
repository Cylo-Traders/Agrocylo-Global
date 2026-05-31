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
  wsManager: { broadcast: vi.fn(), broadcastTo: vi.fn(), clientCount: 0 },
}));
vi.mock("./events/blockchainEventIngestionService.js", () => ({
  BlockchainEventIngestionService: { ingestEvent: vi.fn() },
}));
vi.mock("./events/escrowEventIngestionService.js", () => ({
  EscrowEventIngestionService: { ingestEvent: vi.fn() },
}));

import { detectRecoveryGap, loadCheckpoint, persistCheckpoint } from "./contractWatcher.js";
import { prisma } from "../config/database.js";
import logger from "../config/logger.js";

describe("contractWatcher", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
});
