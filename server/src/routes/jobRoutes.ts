import { Router } from "express";
import logger from "../config/logger.js";
import { getAnalyticsQueue, getIndexingQueue, getNotificationsQueue } from "../queues/queues.js";

const router = Router();

const queuesByName = {
  indexing: getIndexingQueue,
  analytics: getAnalyticsQueue,
  notifications: getNotificationsQueue,
} as const;

router.post("/jobs/:queue", async (req, res) => {
  const queueName = req.params.queue as keyof typeof queuesByName;
  const getQueue = queuesByName[queueName];
  if (!getQueue) {
    res.status(404).json({ message: "Unknown queue", allowed: Object.keys(queuesByName) });
    return;
  }

  const payload = req.body ?? {};
  try {
    const queue = getQueue();
    const job = await queue.add("default", payload, {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });

    logger.info("Job enqueued", { queue: queueName, jobId: job.id } as any);
    res.status(202).json({ queue: queueName, jobId: job.id });
  } catch (err) {
    logger.error("Failed to enqueue job", err);
    res.status(503).json({ message: "Queue unavailable" });
  }
});

export default router;

