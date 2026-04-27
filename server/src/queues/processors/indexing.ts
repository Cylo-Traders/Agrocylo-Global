import type { Job } from "bullmq";
import logger from "../../config/logger.js";

export async function processIndexing(job: Job): Promise<void> {
  logger.info("Indexing job running", { payload: job.data } as any);
  // TODO: connect this to real indexing (e.g., blockchain events, product catalog, etc.)
}

