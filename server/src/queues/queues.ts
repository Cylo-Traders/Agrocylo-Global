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

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    indexingQueue?.close(),
    analyticsQueue?.close(),
    notificationsQueue?.close(),
  ]);
}
