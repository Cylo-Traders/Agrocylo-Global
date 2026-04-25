import type { Job } from "bullmq";
import logger from "../../config/logger.js";

export async function processAnalytics(job: Job): Promise<void> {
  logger.info("Analytics job running", { payload: job.data } as any);
  // TODO: connect this to real analytics (events aggregation, metrics, etc.)
}

