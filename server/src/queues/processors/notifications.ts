import type { Job } from "bullmq";
import logger from "../../config/logger.js";

export async function processNotifications(job: Job): Promise<void> {
  logger.info("Notifications job running", { payload: job.data } as any);
  // TODO: connect this to real notification delivery (email/push/websocket/etc.)
}

