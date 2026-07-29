import logger from "../config/logger.js";
import { runWithLogContext } from "../config/logContext.js";
import { createRedisConnection, type ConnectionOptions } from "./connection.js";
import { processIndexing } from "./processors/indexing.js";
import { processAnalytics } from "./processors/analytics.js";
import { processNotifications } from "./processors/notifications.js";

const { Worker, QueueEvents } = require("bullmq") as {
  Worker: any;
  QueueEvents: any;
};

type RunningWorkers = {
  workers: any[];
  events: any[];
  close: () => Promise<void>;
};

function withJobContext<T>(queue: string, jobId: string, name: string | undefined, fn: () => T): T {
  return runWithLogContext({ job: { queue, jobId, name } }, fn);
}

export function startWorkers(): RunningWorkers {
  const connection: ConnectionOptions = createRedisConnection();
  const opts = { connection, concurrency: 5 };

  const indexing = new Worker("indexing", (job: any) =>
    withJobContext("indexing", String(job.id), job.name, () => processIndexing(job)),
    opts,
  );
  const analytics = new Worker("analytics", (job: any) =>
    withJobContext("analytics", String(job.id), job.name, () => processAnalytics(job)),
    opts,
  );
  const notifications = new Worker("notifications", (job: any) =>
    withJobContext("notifications", String(job.id), job.name, () => processNotifications(job)),
    opts,
  );

  const workers = [indexing, analytics, notifications];

  for (const w of workers) {
    w.on("active", (job: any) =>
      withJobContext(w.name, String(job.id), job.name, () =>
        logger.info("Job active", { attempt: job.attemptsMade }),
      ),
    );
    w.on("completed", (job: any) =>
      withJobContext(w.name, String(job.id), job.name, () => logger.info("Job completed")),
    );
    w.on("failed", (job: any, err: Error) =>
      withJobContext(w.name, String(job?.id ?? "unknown"), job?.name, () =>
        logger.error("Job failed", {
          error: err.message,
          attemptsMade: job?.attemptsMade,
        }),
      ),
    );
    w.on("error", (err: Error) => logger.error("Worker error", err));
  }

  const events = [
    new QueueEvents("indexing", { connection }),
    new QueueEvents("analytics", { connection }),
    new QueueEvents("notifications", { connection }),
  ];

  for (const e of events) {
    e.on("error", (err: Error) => logger.error("QueueEvents error", err));
  }

  async function close(): Promise<void> {
    await Promise.allSettled([...events.map((e) => e.close()), ...workers.map((w) => w.close())]);
  }

  logger.info("Workers started");

  return { workers, events, close };
}
