import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../config/database.js", () => ({
  prisma: {
    blockchainTransaction: {
      upsert: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
    },
  },
}));

import { processIndexing } from "./indexing.js";
import { prisma } from "../../config/database.js";
import logger from "../../config/logger.js";

function makeJob(name: string, data: unknown, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides.id as string | undefined ?? "job-1",
    name,
    data,
    attemptsMade: (overrides.attemptsMade as number) ?? 0,
    timestamp: 1700000000000,
    opts: {},
    returnvalue: null,
    stacktrace: [],
  } as any;
}

describe("processIndexing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("index-contract-events", () => {
    it("should upsert a blockchain transaction for valid contract event data", async () => {
      const eventData = {
        sourceEventId: "evt-001",
        txHash: "0xabc",
        campaignIdOnChain: "camp-1",
        actorAddress: "0x111",
        secondaryAddress: "0x222",
        amount: "500",
        token: "TOKEN",
        status: "active",
      };
      const job = makeJob("index-contract-events", {
        eventType: "campaign.created",
        eventData,
        ledger: 42,
        eventIndex: 7,
        timestamp: "2025-01-15T10:00:00Z",
      });

      await processIndexing(job);

      expect(prisma.blockchainTransaction.upsert).toHaveBeenCalledTimes(1);
      const callArgs = (prisma.blockchainTransaction.upsert as any).mock.calls[0][0];
      expect(callArgs.where).toEqual({ sourceEventId: "evt-001" });
      expect(callArgs.create.eventType).toBe("campaign.created");
      expect(callArgs.create.entity).toBe("campaign");
      expect(callArgs.create.action).toBe("created");
      expect(callArgs.create.ledger).toBe(42);
      expect(callArgs.create.eventIndex).toBe(7);
    });

    it("should derive entity and action for order events", async () => {
      const job = makeJob("index-contract-events", {
        eventType: "order.confirmed",
        eventData: { sourceEventId: "evt-002", orderIdOnChain: "ord-1" },
        ledger: 1,
        eventIndex: 2,
        timestamp: "2025-01-15T10:00:00Z",
      });

      await processIndexing(job);

      const callArgs = (prisma.blockchainTransaction.upsert as any).mock.calls[0][0];
      expect(callArgs.create.entity).toBe("order");
      expect(callArgs.create.action).toBe("confirmed");
    });

    it("should warn and return early when eventData is missing", async () => {
      const job = makeJob("index-contract-events", {
        eventType: "campaign.created",
        ledger: 1,
        eventIndex: 1,
        timestamp: "2025-01-15T10:00:00Z",
      });

      await processIndexing(job);

      expect(logger.warn).toHaveBeenCalledWith(
        "Contract events job received without eventData",
        expect.any(Object),
      );
      expect(prisma.blockchainTransaction.upsert).not.toHaveBeenCalled();
    });

    it("should throw and log when upsert fails", async () => {
      (prisma.blockchainTransaction.upsert as any).mockRejectedValue(new Error("DB error"));

      const job = makeJob("index-contract-events", {
        eventType: "campaign.created",
        eventData: { sourceEventId: "evt-003" },
        ledger: 1,
        eventIndex: 1,
        timestamp: "2025-01-15T10:00:00Z",
      });

      await expect(processIndexing(job)).rejects.toThrow("DB error");
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to index contract event",
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe("index-product-data", () => {
    it("should log and skip when product already exists for create action", async () => {
      (prisma.product.findUnique as any).mockResolvedValue({ id: "prod-1" });

      const job = makeJob("index-product-data", {
        productId: "prod-1",
        action: "create",
        data: { name: "Test" },
      });

      await processIndexing(job);

      expect(prisma.product.findUnique).toHaveBeenCalledWith({ where: { id: "prod-1" } });
      expect(logger.info).toHaveBeenCalledWith(
        "Product already exists, skipping create",
        expect.any(Object),
      );
    });

    it("should log create action when product does not exist", async () => {
      (prisma.product.findUnique as any).mockResolvedValue(null);

      const job = makeJob("index-product-data", {
        productId: "prod-2",
        action: "create",
        data: { name: "New Product" },
      });

      await processIndexing(job);

      expect(logger.info).toHaveBeenCalledWith(
        "Product catalog entry would be created",
        expect.any(Object),
      );
    });

    it("should warn and return for create action without data", async () => {
      const job = makeJob("index-product-data", {
        productId: "prod-3",
        action: "create",
      });

      await processIndexing(job);

      expect(logger.warn).toHaveBeenCalledWith(
        "Product create job received without data",
        expect.any(Object),
      );
    });

    it("should skip update when product not found", async () => {
      (prisma.product.findUnique as any).mockResolvedValue(null);

      const job = makeJob("index-product-data", {
        productId: "prod-nonexistent",
        action: "update",
        data: { name: "Updated" },
      });

      await processIndexing(job);

      expect(logger.warn).toHaveBeenCalledWith(
        "Product not found for update, skipping",
        expect.any(Object),
      );
    });

    it("should log update action when product exists", async () => {
      (prisma.product.findUnique as any).mockResolvedValue({ id: "prod-4" });

      const job = makeJob("index-product-data", {
        productId: "prod-4",
        action: "update",
        data: { name: "Updated" },
      });

      await processIndexing(job);

      expect(logger.info).toHaveBeenCalledWith(
        "Product catalog entry would be updated",
        expect.any(Object),
      );
    });

    it("should log delete action", async () => {
      const job = makeJob("index-product-data", {
        productId: "prod-5",
        action: "delete",
      });

      await processIndexing(job);

      expect(logger.info).toHaveBeenCalledWith(
        "Product catalog entry would be removed",
        expect.any(Object),
      );
    });

    it("should throw and log when database query fails", async () => {
      (prisma.product.findUnique as any).mockRejectedValue(new Error("DB connection lost"));

      const job = makeJob("index-product-data", {
        productId: "prod-6",
        action: "update",
        data: { name: "Fail" },
      });

      await expect(processIndexing(job)).rejects.toThrow("DB connection lost");
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to index product data",
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe("unknown job name", () => {
    it("should log a warning for unrecognized job names", async () => {
      const job = makeJob("unknown-job-type", { some: "data" });

      await processIndexing(job);

      expect(logger.warn).toHaveBeenCalledWith("Unknown indexing job name", expect.any(Object));
    });
  });
});
