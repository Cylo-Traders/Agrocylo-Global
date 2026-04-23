import { Worker, QueueEvents, type WorkerOptions } from "bullmq";
import logger from "../config/logger.js";
import { runWithLogContext } from "../config/logContext.js";
import { createRedisConnection } from "./connection.js";
import { processIndexing } from "./processors/indexing.js";
import { processAnalytics } from "./processors/analytics.js";
import { processNotifications } from "./processors/notifications.js";

type RunningWorkers = {
  workers: Worker[];
  events: QueueEvents[];
  close: () => Promise<void>;
};

function withJobContext<T>(queue: string, jobId: string, name: string | undefined, fn: () => T): T {
  return runWithLogContext({ job: { queue, jobId, name } }, fn);
}

export function startWorkers(): RunningWorkers {
  const connection = createRedisConnection();
  const opts: WorkerOptions = { connection, concurrency: 5 };

  const indexing = new Worker(
    "indexing",
    async (job) => withJobContext("indexing", String(job.id), job.name, () => processIndexing(job)),
    opts,
  );
  const analytics = new Worker(
    "analytics",
    async (job) => withJobContext("analytics", String(job.id), job.name, () => processAnalytics(job)),
    opts,
  );
  const notifications = new Worker(
    "notifications",
    async (job) =>
      withJobContext("notifications", String(job.id), job.name, () => processNotifications(job)),
    opts,
  );

  const workers = [indexing, analytics, notifications];

  for (const w of workers) {
    w.on("active", (job) =>
      withJobContext(w.name, String(job.id), job.name, () =>
        logger.info("Job active", { attempt: job.attemptsMade } as any),
      ),
    );
    w.on("completed", (job) =>
      withJobContext(w.name, String(job.id), job.name, () => logger.info("Job completed")),
    );
    w.on("failed", (job, err) =>
      withJobContext(w.name, String(job?.id ?? "unknown"), job?.name, () =>
        logger.error("Job failed", err),
      ),
    );
    w.on("error", (err) => logger.error("Worker error", err));
  }

  const events = [
    new QueueEvents("indexing", { connection }),
    new QueueEvents("analytics", { connection }),
    new QueueEvents("notifications", { connection }),
  ];

  for (const e of events) {
    e.on("error", (err) => logger.error("QueueEvents error", err));
  }

  async function close(): Promise<void> {
    await Promise.allSettled([...events.map((e) => e.close()), ...workers.map((w) => w.close())]);
    await connection.quit();
  }

  logger.info("Workers started");

  return { workers, events, close };
}

