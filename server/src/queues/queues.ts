import { Queue } from "bullmq";
import { createRedisConnection } from "./connection.js";

type RedisConnectionOptions = ReturnType<typeof createRedisConnection>;

let connection: RedisConnectionOptions | undefined;
let indexingQueue: Queue | undefined;
let analyticsQueue: Queue | undefined;
let notificationsQueue: Queue | undefined;

function getConnection(): RedisConnectionOptions {
  connection ??= createRedisConnection();
  return connection;
}

export function getIndexingQueue(): Queue {
  if (!indexingQueue) indexingQueue = new Queue("indexing", { connection: getConnection() });
  return indexingQueue;
}

export function getAnalyticsQueue(): Queue {
  if (!analyticsQueue) analyticsQueue = new Queue("analytics", { connection: getConnection() });
  return analyticsQueue;
}

export function getNotificationsQueue(): Queue {
  if (!notificationsQueue)
    notificationsQueue = new Queue("notifications", { connection: getConnection() });
  return notificationsQueue;
}

const PRICE_INDEX_INTERVAL_MS = 60 * 60 * 1000; // hourly

/**
 * Registers the recurring price-index aggregation job (Issue #594). Idempotent:
 * BullMQ deduplicates repeatable jobs with the same name/pattern/jobId.
 */
export async function schedulePriceIndexAggregation(): Promise<void> {
  await getAnalyticsQueue().add(
    "aggregate-price-index",
    {},
    {
      repeat: { every: PRICE_INDEX_INTERVAL_MS },
      jobId: "price-index-aggregation",
      removeOnComplete: 10,
      removeOnFail: 10,
    },
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    indexingQueue?.close(),
    analyticsQueue?.close(),
    notificationsQueue?.close(),
  ]);
}
