import { createRedisConnection, type ConnectionOptions } from "./connection.js";

// bullmq 5.77.6 ships incomplete type declarations, so we work around via require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Queue } = require("bullmq") as { Queue: any };

let connection: ConnectionOptions | undefined;
let indexingQueue: any;
let analyticsQueue: any;
let notificationsQueue: any;

function getConnection(): ConnectionOptions {
  connection ??= createRedisConnection();
  return connection;
}

export function getIndexingQueue(): any {
  if (!indexingQueue) indexingQueue = new Queue("indexing", { connection: getConnection() });
  return indexingQueue;
}

export function getAnalyticsQueue(): any {
  if (!analyticsQueue) analyticsQueue = new Queue("analytics", { connection: getConnection() });
  return analyticsQueue;
}

export function getNotificationsQueue(): any {
  if (!notificationsQueue)
    notificationsQueue = new Queue("notifications", { connection: getConnection() });
  return notificationsQueue;
}

const PRICE_INDEX_INTERVAL_MS = 60 * 60 * 1000;

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
