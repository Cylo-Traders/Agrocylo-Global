import { Queue } from "bullmq";
import { createRedisConnection, type ConnectionOptions } from "./connection.js";

let connection: ConnectionOptions | undefined;
let indexingQueue: any;
let analyticsQueue: any;
let notificationsQueue: any;
let reconciliationQueue: any;

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

export function getReconciliationQueue(): any {
  if (!reconciliationQueue)
    reconciliationQueue = new Queue("reconciliation", { connection: getConnection() });
  return reconciliationQueue;
}

const PRICE_INDEX_INTERVAL_MS = 60 * 60 * 1000;
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

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

export async function scheduleReconciliation(): Promise<void> {
  await getReconciliationQueue().add(
    "reconciliation",
    {},
    {
      repeat: { every: RECONCILIATION_INTERVAL_MS },
      jobId: "reconciliation",
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
    reconciliationQueue?.close(),
  ]);
}
