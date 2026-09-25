import { Router } from "express";
import { z } from "zod";
import logger from "../config/logger.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { writeLimiter } from "../middleware/rateLimiter.js";
import { getAnalyticsQueue, getIndexingQueue, getNotificationsQueue } from "../queues/queues.js";
import type {
  AggregateMetricsJobData,
  AggregatePriceIndexJobData,
  GenerateReportJobData,
  IndexContractEventsJobData,
  IndexProductDataJobData,
  SendEmailJobData,
  SendPushJobData,
  SendWebSocketJobData,
} from "../queues/job-types.js";

const router = Router();

const record = z.record(z.string(), z.unknown());

// Allowlist of { name, data } per queue; names match the processor switch cases.
const jobSchemasByQueue = {
  indexing: z.discriminatedUnion("name", [
    z.object({
      name: z.literal("index-contract-events"),
      data: z.object({
        eventType: z.string().min(1),
        eventData: z.unknown(),
        ledger: z.string().min(1),
        eventIndex: z.number().int().nonnegative(),
        timestamp: z.string().min(1),
      }) satisfies z.ZodType<IndexContractEventsJobData>,
    }),
    z.object({
      name: z.literal("index-product-data"),
      data: z.object({
        productId: z.string().min(1),
        action: z.enum(["create", "update", "delete"]),
        data: record.optional(),
      }) satisfies z.ZodType<IndexProductDataJobData>,
    }),
  ]),
  analytics: z.discriminatedUnion("name", [
    z.object({
      name: z.literal("aggregate-metrics"),
      data: z.object({
        metricName: z.string().min(1),
        granularity: z.enum(["hourly", "daily", "weekly"]),
        startDate: z.string().min(1),
        endDate: z.string().min(1),
      }) satisfies z.ZodType<AggregateMetricsJobData>,
    }),
    z.object({
      name: z.literal("generate-report"),
      data: z.object({
        reportType: z.enum(["sales", "inventory", "demand", "supply"]),
        parameters: record,
      }) satisfies z.ZodType<GenerateReportJobData>,
    }),
    z.object({
      name: z.literal("aggregate-price-index"),
      data: z.object({}).strict() satisfies z.ZodType<AggregatePriceIndexJobData>,
    }),
  ]),
  notifications: z.discriminatedUnion("name", [
    z.object({
      name: z.literal("send-email"),
      data: z.object({
        to: z.string().email(),
        subject: z.string().min(1),
        body: z.string().min(1),
        html: z.string().optional(),
      }) satisfies z.ZodType<SendEmailJobData>,
    }),
    z.object({
      name: z.literal("send-push"),
      data: z.object({
        walletAddress: z.string().min(1),
        title: z.string().min(1),
        body: z.string().min(1),
        data: record.optional(),
      }) satisfies z.ZodType<SendPushJobData>,
    }),
    z.object({
      name: z.literal("send-websocket"),
      data: z.object({
        event: z.string().min(1),
        data: z.unknown(),
        wallets: z.array(z.string()).optional(),
      }) satisfies z.ZodType<SendWebSocketJobData>,
    }),
  ]),
} as const;

const queuesByName = {
  indexing: getIndexingQueue,
  analytics: getAnalyticsQueue,
  notifications: getNotificationsQueue,
} as const;

router.post("/jobs/:queue", writeLimiter, requireAdmin, async (req, res) => {
  const queueName = req.params.queue as keyof typeof queuesByName;
  const getQueue = queuesByName[queueName];
  if (!getQueue) {
    res.status(404).json({ message: "Unknown queue", allowed: Object.keys(queuesByName) });
    return;
  }

  const parsed = jobSchemasByQueue[queueName].safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid job", issues: parsed.error.issues });
    return;
  }

  try {
    const queue = getQueue();
    const job = await queue.add(parsed.data.name, parsed.data.data, {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });

    logger.info("Job enqueued", { queue: queueName, name: parsed.data.name, jobId: job.id });
    res.status(202).json({ queue: queueName, name: parsed.data.name, jobId: job.id });
  } catch (err) {
    logger.error("Failed to enqueue job", err);
    res.status(503).json({ message: "Queue unavailable" });
  }
});

export default router;
