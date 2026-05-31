import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../config/database.js", () => ({
  prisma: {
    order: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    product: {
      count: vi.fn(),
    },
    buyerDemand: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    farmerSupply: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

import { processAnalytics } from "./analytics.js";
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

describe("processAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("aggregate-metrics", () => {
    it("should aggregate order_count metric", async () => {
      (prisma.order.count as any).mockResolvedValue(42);

      const job = makeJob("aggregate-metrics", {
        metricName: "order_count",
        granularity: "daily",
        startDate: "2025-01-01T00:00:00Z",
        endDate: "2025-01-31T23:59:59Z",
      });

      await processAnalytics(job);

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        },
      });
    });

    it("should aggregate total_volume metric", async () => {
      (prisma.order.findMany as any).mockResolvedValue([
        { amount: "100.5" },
        { amount: "200.3" },
        { amount: "invalid" },
      ]);

      const job = makeJob("aggregate-metrics", {
        metricName: "total_volume",
        granularity: "daily",
        startDate: "2025-01-01T00:00:00Z",
        endDate: "2025-01-31T23:59:59Z",
      });

      await processAnalytics(job);

      expect(prisma.order.findMany).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "Metrics aggregated",
        expect.objectContaining({ metricName: "total_volume", value: 300.8 }),
      );
    });

    it("should aggregate active_users metric", async () => {
      (prisma.order.groupBy as any)
        .mockResolvedValueOnce([{ buyerAddress: "0xa" }, { buyerAddress: "0xb" }])
        .mockResolvedValueOnce([{ sellerAddress: "0xa" }, { sellerAddress: "0xc" }]);

      const job = makeJob("aggregate-metrics", {
        metricName: "active_users",
        granularity: "daily",
        startDate: "2025-01-01T00:00:00Z",
        endDate: "2025-01-31T23:59:59Z",
      });

      await processAnalytics(job);

      expect(prisma.order.groupBy).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        "Metrics aggregated",
        expect.objectContaining({ metricName: "active_users", value: 3 }),
      );
    });

    it("should aggregate product_count metric", async () => {
      (prisma.product.count as any).mockResolvedValue(15);

      const job = makeJob("aggregate-metrics", {
        metricName: "product_count",
        granularity: "daily",
        startDate: "2025-01-01T00:00:00Z",
        endDate: "2025-01-31T23:59:59Z",
      });

      await processAnalytics(job);

      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { isAvailable: true },
      });
      expect(logger.info).toHaveBeenCalledWith(
        "Metrics aggregated",
        expect.objectContaining({ metricName: "product_count", value: 15 }),
      );
    });

    it("should warn for unknown metric names", async () => {
      const job = makeJob("aggregate-metrics", {
        metricName: "unknown_metric",
        granularity: "daily",
        startDate: "2025-01-01T00:00:00Z",
        endDate: "2025-01-31T23:59:59Z",
      });

      await processAnalytics(job);

      expect(logger.warn).toHaveBeenCalledWith(
        "Unknown metric requested for aggregation",
        expect.any(Object),
      );
    });

    it("should handle database errors gracefully", async () => {
      (prisma.order.count as any).mockRejectedValue(new Error("DB timeout"));

      const job = makeJob("aggregate-metrics", {
        metricName: "order_count",
        granularity: "daily",
        startDate: "2025-01-01T00:00:00Z",
        endDate: "2025-01-31T23:59:59Z",
      });

      await expect(processAnalytics(job)).rejects.toThrow("DB timeout");
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to aggregate metrics",
        expect.any(Error),
        expect.any(Object),
      );
    });

    it("should default date range when not provided", async () => {
      (prisma.order.count as any).mockResolvedValue(10);

      const job = makeJob("aggregate-metrics", {
        metricName: "order_count",
        granularity: "daily",
        startDate: "",
        endDate: "",
      });

      await processAnalytics(job);

      const callArgs = (prisma.order.count as any).mock.calls[0][0];
      expect(callArgs.where.createdAt.gte).toBeInstanceOf(Date);
      expect(callArgs.where.createdAt.lte).toBeInstanceOf(Date);
    });
  });

  describe("generate-report", () => {
    it("should generate a sales report", async () => {
      (prisma.order.count as any).mockResolvedValue(100);
      (prisma.order.findMany as any).mockResolvedValue([
        { amount: "50" },
        { amount: "75.5" },
      ]);

      const job = makeJob("generate-report", {
        reportType: "sales",
        parameters: { status: "COMPLETED" },
      });

      await processAnalytics(job);

      expect(prisma.order.count).toHaveBeenCalled();
      expect(prisma.order.findMany).toHaveBeenCalledWith({
        select: { amount: true },
      });
      expect(logger.info).toHaveBeenCalledWith(
        "Report generated",
        expect.objectContaining({
          reportType: "sales",
          summary: expect.objectContaining({
            totalOrders: 100,
            totalVolume: 125.5,
          }),
        }),
      );
    });

    it("should generate an inventory report", async () => {
      (prisma.product.count as any)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(10);

      const job = makeJob("generate-report", {
        reportType: "inventory",
        parameters: {},
      });

      await processAnalytics(job);

      expect(prisma.product.count).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        "Report generated",
        expect.objectContaining({
          reportType: "inventory",
          summary: expect.objectContaining({
            availableProducts: 8,
            totalProducts: 10,
            outOfStock: 2,
          }),
        }),
      );
    });

    it("should generate a demand report", async () => {
      (prisma.buyerDemand.count as any).mockResolvedValue(5);
      (prisma.buyerDemand.groupBy as any).mockResolvedValue([
        { cropName: "Wheat", _count: { id: 3 }, _sum: { quantityWanted: 100 } },
        { cropName: "Rice", _count: { id: 2 }, _sum: { quantityWanted: 50 } },
      ]);

      const job = makeJob("generate-report", {
        reportType: "demand",
        parameters: {},
      });

      await processAnalytics(job);

      expect(logger.info).toHaveBeenCalledWith(
        "Report generated",
        expect.objectContaining({
          reportType: "demand",
          summary: expect.objectContaining({
            activeDemands: 5,
            demandsByCrop: expect.any(Array),
          }),
        }),
      );
    });

    it("should generate a supply report", async () => {
      (prisma.farmerSupply.count as any).mockResolvedValue(7);
      (prisma.farmerSupply.groupBy as any).mockResolvedValue([
        { cropName: "Corn", _count: { id: 4 }, _sum: { quantityAvailable: 200 } },
      ]);

      const job = makeJob("generate-report", {
        reportType: "supply",
        parameters: {},
      });

      await processAnalytics(job);

      expect(logger.info).toHaveBeenCalledWith(
        "Report generated",
        expect.objectContaining({
          reportType: "supply",
          summary: expect.objectContaining({ activeSupplies: 7 }),
        }),
      );
    });

    it("should warn for unknown report types", async () => {
      const job = makeJob("generate-report", {
        reportType: "unknown-type" as any,
        parameters: {},
      });

      await processAnalytics(job);

      expect(logger.warn).toHaveBeenCalledWith(
        "Unknown report type requested",
        expect.any(Object),
      );
    });

    it("should handle database errors in report generation", async () => {
      (prisma.order.count as any).mockRejectedValue(new Error("Query failed"));

      const job = makeJob("generate-report", {
        reportType: "sales",
        parameters: {},
      });

      await expect(processAnalytics(job)).rejects.toThrow("Query failed");
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to generate report",
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe("unknown job name", () => {
    it("should log a warning for unrecognized job names", async () => {
      const job = makeJob("unknown-job", { some: "data" });

      await processAnalytics(job);

      expect(logger.warn).toHaveBeenCalledWith("Unknown analytics job name", expect.any(Object));
    });
  });
});
