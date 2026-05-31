import type { Job } from "bullmq";
import logger from "../../config/logger.js";
import type {
  IndexContractEventsJobData,
  IndexProductDataJobData,
} from "../job-types.js";
import { prisma } from "../../config/database.js";

async function handleIndexContractEvents(job: Job<IndexContractEventsJobData>): Promise<void> {
  const { eventType, eventData, ledger, eventIndex } = job.data;

  const data = eventData as Record<string, unknown> | undefined;
  if (!data) {
    logger.warn("Contract events job received without eventData", { jobId: job.id });
    return;
  }

  const sourceEventId = data.sourceEventId as string | undefined ?? `idx-${job.id}`;
  const txHash = data.txHash as string | undefined;

  try {
    const entity =
      eventType.startsWith("campaign") ? "campaign" : eventType.startsWith("order") ? "order" : "unknown";

    const action = eventType.includes(".")
      ? (eventType.split(".")[1] as string)
      : eventType;

    await prisma.blockchainTransaction.upsert({
      where: { sourceEventId },
      create: {
        sourceEventId,
        eventType,
        entity,
        action,
        ledger: Number(ledger) || 0,
        eventIndex: Number(eventIndex) || 0,
        txHash: txHash ?? null,
        campaignIdOnChain: data.campaignIdOnChain as string | undefined ?? null,
        orderIdOnChain: data.orderIdOnChain as string | undefined ?? null,
        payload: data as never,
      },
      update: {
        eventType,
        entity,
        action,
        payload: data as never,
      },
    });

    logger.info("Contract event indexed", {
      jobId: job.id,
      eventType,
      sourceEventId,
    });
  } catch (error) {
    logger.error("Failed to index contract event", error, {
      jobId: job.id,
      eventType,
      sourceEventId,
    });
    throw error;
  }
}

async function handleIndexProductData(job: Job<IndexProductDataJobData>): Promise<void> {
  const { productId, action, data } = job.data;

  try {
    switch (action) {
      case "create": {
        if (!data) {
          logger.warn("Product create job received without data", { jobId: job.id, productId });
          return;
        }
        const existing = await prisma.product.findUnique({ where: { id: productId } });
        if (existing) {
          logger.info("Product already exists, skipping create", { jobId: job.id, productId });
          return;
        }
        logger.info("Product catalog entry would be created", {
          jobId: job.id,
          productId,
          data,
        });
        break;
      }
      case "update": {
        const existing = await prisma.product.findUnique({ where: { id: productId } });
        if (!existing) {
          logger.warn("Product not found for update, skipping", { jobId: job.id, productId });
          return;
        }
        logger.info("Product catalog entry would be updated", {
          jobId: job.id,
          productId,
          data,
        });
        break;
      }
      case "delete": {
        logger.info("Product catalog entry would be removed", {
          jobId: job.id,
          productId,
        });
        break;
      }
      default:
        logger.warn("Unknown product indexing action", {
          jobId: job.id,
          productId,
          action,
        });
    }
  } catch (error) {
    logger.error("Failed to index product data", error, {
      jobId: job.id,
      productId,
      action,
    });
    throw error;
  }
}

export async function processIndexing(job: Job): Promise<void> {
  try {
    logger.info("Indexing job started", {
      jobId: job.id,
      name: job.name,
      attempt: job.attemptsMade,
    });

    switch (job.name) {
      case "index-contract-events":
        await handleIndexContractEvents(job);
        break;
      case "index-product-data":
        await handleIndexProductData(job);
        break;
      default:
        logger.warn("Unknown indexing job name", {
          jobId: job.id,
          name: job.name,
        });
    }
  } catch (error) {
    logger.error("Indexing job failed", error, {
      jobId: job.id,
      name: job.name,
      attempt: job.attemptsMade,
    });
    throw error;
  }
}
