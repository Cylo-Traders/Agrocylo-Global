import { Worker, QueueEvents } from "bullmq";
import logger from "../config/logger.js";
import { runWithLogContext } from "../config/logContext.js";
import { createRedisConnection, type ConnectionOptions } from "./connection.js";
import { processIndexing } from "./processors/indexing.js";
import { processAnalytics } from "./processors/analytics.js";
import { processNotifications } from "./processors/notifications.js";
import { processReconciliation } from "./processors/reconciliation.js";
import { queueJobLagSeconds, queueJobFailuresTotal } from "../services/promMetrics.js";
import { captureAlert } from "../config/sentry.js";

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
  const reconciliation = new Worker("reconciliation", (job: any) =>
    withJobContext("reconciliation", String(job.id), job.name, () => processReconciliation(job)),
    { ...opts, concurrency: 1 },
  );

  const workers = [indexing, analytics, notifications, reconciliation];

  for (const w of workers) {
    w.on("active", (job: any) =>
      withJobContext(w.name, String(job.id), job.name, () => {
        // Queue lag (Issue #756): time between enqueue and a worker actually
        // picking the job up — the backlog/starvation indicator.
        if (typeof job.timestamp === "number") {
          queueJobLagSeconds.observe({ queue: w.name }, (Date.now() - job.timestamp) / 1000);
        }
        logger.info("Job active", { attempt: job.attemptsMade });
      }),
    );
    w.on("completed", (job: any) =>
      withJobContext(w.name, String(job.id), job.name, () => logger.info("Job completed")),
    );
    w.on("failed", (job: any, err: Error) => {
      withJobContext(w.name, String(job?.id ?? "unknown"), job?.name, () => {
        logger.error("Job failed", {
          error: err.message,
          attemptsMade: job?.attemptsMade,
        });
        queueJobFailuresTotal.inc({ queue: w.name, job: job?.name ?? "unknown" });

        // Only alert once a job has exhausted its retries — a single
        // transient failure that BullMQ will retry isn't yet an incident.
        // This is the "failed scheduled jobs (weather polling, price-index
        // aggregation)" alert from Issue #756: `aggregate-price-index` runs
        // as a job on this ("analytics") queue.
        const maxAttempts = job?.opts?.attempts ?? 1;
        if ((job?.attemptsMade ?? 0) >= maxAttempts) {
          captureAlert(
            "scheduled_job_failed",
            `Job "${job?.name ?? "unknown"}" on queue "${w.name}" failed permanently after ${job?.attemptsMade ?? "?"} attempt(s)`,
            { queue: w.name, jobName: job?.name, jobId: job?.id, error: err.message },
          );
        }
      });
    });
    w.on("error", (err: Error) => logger.error("Worker error", err));
  }

  const events = [
    new QueueEvents("indexing", { connection }),
    new QueueEvents("analytics", { connection }),
    new QueueEvents("notifications", { connection }),
    new QueueEvents("reconciliation", { connection }),
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
