import type { Job } from "bullmq";
import logger from "../../config/logger.js";
import type {
  AggregateMetricsJobData,
  GenerateReportJobData,
} from "../job-types.js";
import { prisma } from "../../config/database.js";

async function handleAggregateMetrics(job: Job<AggregateMetricsJobData>): Promise<void> {
  const { metricName, startDate, endDate } = job.data;

  const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();

  try {
    let value: number | Record<string, unknown>;

    switch (metricName) {
      case "order_count": {
        const count = await prisma.order.count({
          where: { createdAt: { gte: start, lte: end } },
        });
        value = count;
        break;
      }
      case "total_volume": {
        const orders = await prisma.order.findMany({
          where: { createdAt: { gte: start, lte: end } },
          select: { amount: true },
        });
        value = orders.reduce((sum, o) => {
          const n = Number(o.amount);
          return Number.isFinite(n) ? sum + n : sum;
        }, 0);
        break;
      }
      case "active_users": {
        const activeUsers = await prisma.order.groupBy({
          by: ["buyerAddress"],
          where: { createdAt: { gte: start, lte: end } },
        });
        const sellerUsers = await prisma.order.groupBy({
          by: ["sellerAddress"],
          where: { createdAt: { gte: start, lte: end } },
        });
        const unique = new Set([
          ...activeUsers.map((u) => u.buyerAddress),
          ...sellerUsers.map((u) => u.sellerAddress),
        ]);
        value = unique.size;
        break;
      }
      case "product_count": {
        value = await prisma.product.count({
          where: { isAvailable: true },
        });
        break;
      }
      default: {
        logger.warn("Unknown metric requested for aggregation", {
          jobId: job.id,
          metricName,
        });
        return;
      }
    }

    logger.info("Metrics aggregated", {
      jobId: job.id,
      metricName,
      value,
      period: { start: start.toISOString(), end: end.toISOString() },
    });
  } catch (error) {
    logger.error("Failed to aggregate metrics", error, {
      jobId: job.id,
      metricName,
    });
    throw error;
  }
}

async function handleGenerateReport(job: Job<GenerateReportJobData>): Promise<void> {
  const { reportType, parameters } = job.data;

  try {
    const reportDate = new Date().toISOString();
    let summary: Record<string, unknown>;

    switch (reportType) {
      case "sales": {
        const orders = await prisma.order.count({
          where: parameters.status
            ? { status: parameters.status as string }
            : {},
        });
        const ordersWithAmount = await prisma.order.findMany({
          select: { amount: true },
        });
        const totalVolume = ordersWithAmount.reduce((sum, o) => {
          const n = Number(o.amount);
          return Number.isFinite(n) ? sum + n : sum;
        }, 0);
        summary = { totalOrders: orders, totalVolume, generatedAt: reportDate };
        break;
      }
      case "inventory": {
        const availableProducts = await prisma.product.count({
          where: { isAvailable: true },
        });
        const totalProducts = await prisma.product.count();
        summary = {
          availableProducts,
          totalProducts,
          outOfStock: totalProducts - availableProducts,
          generatedAt: reportDate,
        };
        break;
      }
      case "demand": {
        const activeDemands = await prisma.buyerDemand.count();
        const demandsByCrop = await prisma.buyerDemand.groupBy({
          by: ["cropName"],
          _count: { id: true },
        });
        summary = { activeDemands, demandsByCrop, generatedAt: reportDate };
        break;
      }
      case "supply": {
        const activeSupplies = await prisma.farmerSupply.count();
        const suppliesByCrop = await prisma.farmerSupply.groupBy({
          by: ["cropName"],
          _count: { id: true },
        });
        summary = { activeSupplies, suppliesByCrop, generatedAt: reportDate };
        break;
      }
      default: {
        logger.warn("Unknown report type requested", {
          jobId: job.id,
          reportType,
        });
        return;
      }
    }

    logger.info("Report generated", {
      jobId: job.id,
      reportType,
      summary,
    });
  } catch (error) {
    logger.error("Failed to generate report", error, {
      jobId: job.id,
      reportType,
    });
    throw error;
  }
}

export async function processAnalytics(job: Job): Promise<void> {
  try {
    logger.info("Analytics job started", {
      jobId: job.id,
      name: job.name,
      attempt: job.attemptsMade,
    });

    switch (job.name) {
      case "aggregate-metrics":
        await handleAggregateMetrics(job);
        break;
      case "generate-report":
        await handleGenerateReport(job);
        break;
      default:
        logger.warn("Unknown analytics job name", {
          jobId: job.id,
          name: job.name,
        });
    }
  } catch (error) {
    logger.error("Analytics job failed", error, {
      jobId: job.id,
      name: job.name,
      attempt: job.attemptsMade,
    });
    throw error;
  }
}
