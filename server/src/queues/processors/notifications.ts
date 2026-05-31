import type { Job } from "bullmq";
import logger from "../../config/logger.js";
import type {
  SendEmailJobData,
  SendPushJobData,
  SendWebSocketJobData,
} from "../job-types.js";
import { wsManager } from "../../services/wsManager.js";
import { NotificationService } from "../../services/notificationService.js";

async function handleSendEmail(job: Job<SendEmailJobData>): Promise<void> {
  const { to, subject, body, html } = job.data;

  if (!to || !subject) {
    logger.warn("Email job missing required fields", {
      jobId: job.id,
      hasTo: !!to,
      hasSubject: !!subject,
    });
    return;
  }

  try {
    logger.info("Email would be sent", {
      jobId: job.id,
      to,
      subject,
      hasHtml: !!html,
    });

    // Placeholder for actual email provider integration (e.g., SendGrid, SES, SMTP)
    // await emailService.send({ to, subject, body, html });
  } catch (error) {
    logger.error("Failed to send email", error, {
      jobId: job.id,
      to,
      subject,
    });
    throw error;
  }
}

async function handleSendPush(job: Job<SendPushJobData>): Promise<void> {
  const { walletAddress, title, body, data } = job.data;

  if (!walletAddress || !title) {
    logger.warn("Push notification job missing required fields", {
      jobId: job.id,
      hasWallet: !!walletAddress,
      hasTitle: !!title,
    });
    return;
  }

  try {
    const connectedCount = wsManager.clientCount;
    wsManager.broadcastTo(walletAddress, "notification:push", {
      title,
      body,
      data: data ?? null,
      timestamp: new Date().toISOString(),
    });

    if (connectedCount > 0) {
      logger.info("Push notification delivered via WebSocket", {
        jobId: job.id,
        walletAddress,
        connectedClients: connectedCount,
      });
    } else {
      logger.info("Push notification queued (no connected clients)", {
        jobId: job.id,
        walletAddress,
      });
    }

    await NotificationService.notify({
      walletAddress,
      type: "ORDER_CREATED" as never,
      orderId: data?.orderId as string | undefined ?? "unknown",
    });
  } catch (error) {
    logger.error("Failed to send push notification", error, {
      jobId: job.id,
      walletAddress,
    });
    throw error;
  }
}

async function handleSendWebSocket(job: Job<SendWebSocketJobData>): Promise<void> {
  const { event, data, wallets } = job.data;

  if (!event) {
    logger.warn("WebSocket job missing required event field", {
      jobId: job.id,
    });
    return;
  }

  try {
    if (wallets && wallets.length > 0) {
      for (const wallet of wallets) {
        wsManager.broadcastTo(wallet, event, data);
      }
      logger.info("WebSocket message sent to specific wallets", {
        jobId: job.id,
        event,
        walletCount: wallets.length,
      });
    } else {
      wsManager.broadcast(event, data);
      logger.info("WebSocket message broadcast to all clients", {
        jobId: job.id,
        event,
      });
    }
  } catch (error) {
    logger.error("Failed to send WebSocket message", error, {
      jobId: job.id,
      event,
    });
    throw error;
  }
}

export async function processNotifications(job: Job): Promise<void> {
  try {
    logger.info("Notification job started", {
      jobId: job.id,
      name: job.name,
      attempt: job.attemptsMade,
    });

    switch (job.name) {
      case "send-email":
        await handleSendEmail(job);
        break;
      case "send-push":
        await handleSendPush(job);
        break;
      case "send-websocket":
        await handleSendWebSocket(job);
        break;
      default:
        logger.warn("Unknown notification job name", {
          jobId: job.id,
          name: job.name,
        });
    }
  } catch (error) {
    logger.error("Notification job failed", error, {
      jobId: job.id,
      name: job.name,
      attempt: job.attemptsMade,
    });
    throw error;
  }
}
