import type { CampaignStatus, OrderStatus } from "@prisma/client";
import { prisma } from "../db/client.js";
import logger from "../config/logger.js";
import type {
  CampaignCreatedEvent,
  CampaignInvestedEvent,
  CampaignSettledEvent,
  GenericCampaignEvent,
  OrderConfirmedEvent,
  OrderCreatedEvent,
  ParsedEvent,
} from "./types.js";

/**
 * Persists a parsed event to the database. All writes are idempotent — safe to
 * replay if the indexer restarts or re-processes the same ledger range.
 */
export class EventPersister {
  static async persist(event: ParsedEvent): Promise<void> {
    // Guard against duplicate events at the DB level via the unique index on
    // transactions(ledger, eventIndex).
    const alreadyProcessed = await prisma.transaction.findUnique({
      where: { ledger_eventIndex: { ledger: event.ledger, eventIndex: event.eventIndex } },
    });
    if (alreadyProcessed) {
      logger.debug("EventPersister: skipping duplicate", {
        ledger: event.ledger,
        eventIndex: event.eventIndex,
      });
      return;
    }

    switch (event.action) {
      case "campaign.created":
        await handleCampaignCreated(event);
        break;
      case "campaign.invested":
        await handleCampaignInvested(event);
        break;
      case "campaign.settled":
        await handleCampaignSettled(event);
        break;
      case "order.created":
        await handleOrderCreated(event);
        break;
      case "order.confirmed":
        await handleOrderConfirmed(event);
        break;
      case "campaign.produce":
        await updateCampaignStatus(event, "IN_PRODUCTION");
        break;
      case "campaign.harvest":
        await updateCampaignStatus(event, "HARVESTED");
        break;
      case "campaign.failed":
        await updateCampaignStatus(event, "FAILED");
        break;
      case "campaign.disputed":
        await updateCampaignStatus(event, "DISPUTED");
        break;
      default:
        // Record the raw transaction but don't update domain models.
        await recordTransaction(event, null);
        return;
    }

    logger.info("EventPersister: persisted", { action: event.action, ledger: event.ledger });
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleCampaignCreated(event: CampaignCreatedEvent) {
  const deadlineTs = parseInt(event.deadline, 10);
  const deadline = Number.isFinite(deadlineTs)
    ? new Date(deadlineTs * 1000)
    : new Date(event.deadline);

  await prisma.$transaction(async (tx) => {
    await upsertUser(tx, event.farmer, "FARMER");

    const campaign = await tx.campaign.upsert({
      where: { onChainId: event.campaignId },
      create: {
        onChainId: event.campaignId,
        farmerAddress: event.farmer,
        tokenAddress: event.token,
        targetAmount: event.targetAmount,
        deadline,
        status: "FUNDING",
      },
      update: {},
    });

    await tx.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: event.action,
        payload: event as unknown as Record<string, unknown>,
        ledger: event.ledger,
        eventIndex: event.eventIndex,
      },
    });
  });
}

async function handleCampaignInvested(event: CampaignInvestedEvent) {
  await prisma.$transaction(async (tx) => {
    await upsertUser(tx, event.investor, "INVESTOR");

    const campaign = await tx.campaign.findUnique({
      where: { onChainId: event.campaignId },
    });
    if (!campaign) {
      logger.warn("EventPersister: investment for unknown campaign", {
        campaignId: event.campaignId,
      });
      return;
    }

    await tx.campaign.update({
      where: { onChainId: event.campaignId },
      data: {
        totalRaised: event.totalRaised,
        status: event.totalRaised === campaign.targetAmount ? "FUNDED" : undefined,
      },
    });

    await tx.investment.upsert({
      where: {
        campaignId_investorAddress_ledger: {
          campaignId: campaign.id,
          investorAddress: event.investor,
          ledger: event.ledger,
        },
      },
      create: {
        campaignId: campaign.id,
        investorAddress: event.investor,
        amount: event.amount,
        ledger: event.ledger,
      },
      update: {},
    });

    await tx.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: event.action,
        payload: event as unknown as Record<string, unknown>,
        ledger: event.ledger,
        eventIndex: event.eventIndex,
      },
    });
  });
}

async function handleCampaignSettled(event: CampaignSettledEvent) {
  await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({
      where: { onChainId: event.campaignId },
    });
    if (!campaign) {
      logger.warn("EventPersister: settled event for unknown campaign", {
        campaignId: event.campaignId,
      });
      return;
    }

    await tx.campaign.update({
      where: { onChainId: event.campaignId },
      data: {
        totalRevenue: event.totalRevenue,
        status: "SETTLED",
      },
    });

    await tx.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: event.action,
        payload: event as unknown as Record<string, unknown>,
        ledger: event.ledger,
        eventIndex: event.eventIndex,
      },
    });
  });
}

async function handleOrderCreated(event: OrderCreatedEvent) {
  await prisma.$transaction(async (tx) => {
    await upsertUser(tx, event.buyer, "BUYER");

    const campaign = await tx.campaign.findUnique({
      where: { onChainId: event.campaignId },
    });
    if (!campaign) {
      logger.warn("EventPersister: order for unknown campaign", {
        campaignId: event.campaignId,
      });
      return;
    }

    await tx.order.upsert({
      where: { onChainId: event.orderId },
      create: {
        onChainId: event.orderId,
        campaignId: campaign.id,
        buyerAddress: event.buyer,
        amount: event.amount,
        status: "PENDING",
        ledger: event.ledger,
      },
      update: {},
    });

    await tx.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: event.action,
        payload: event as unknown as Record<string, unknown>,
        ledger: event.ledger,
        eventIndex: event.eventIndex,
      },
    });
  });
}

async function handleOrderConfirmed(event: OrderConfirmedEvent) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { onChainId: event.orderId },
    });
    if (!order) {
      logger.warn("EventPersister: confirm for unknown order", {
        orderId: event.orderId,
      });
      return;
    }

    const updatedOrder = await tx.order.update({
      where: { onChainId: event.orderId },
      data: { status: "CONFIRMED" },
    });

    // Add revenue to the campaign.
    await tx.campaign.update({
      where: { id: order.campaignId },
      data: {
        totalRevenue: {
          // Prisma doesn't support string arithmetic; we use raw increment via a
          // separate query or handle in application logic. For safety, fetch
          // and update.
        },
      },
    });

    const campaign = await tx.campaign.findUnique({ where: { id: order.campaignId } });
    if (campaign) {
      const prev = BigInt(campaign.totalRevenue);
      const added = BigInt(order.amount);
      await tx.campaign.update({
        where: { id: order.campaignId },
        data: { totalRevenue: String(prev + added) },
      });
    }

    await tx.transaction.create({
      data: {
        campaignId: order.campaignId,
        eventType: event.action,
        payload: event as unknown as Record<string, unknown>,
        ledger: event.ledger,
        eventIndex: event.eventIndex,
      },
    });
  });
}

async function updateCampaignStatus(
  event: GenericCampaignEvent,
  status: CampaignStatus,
) {
  await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({
      where: { onChainId: event.campaignId },
    });
    if (!campaign) return;

    await tx.campaign.update({
      where: { onChainId: event.campaignId },
      data: { status },
    });

    await tx.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: event.action,
        payload: event as unknown as Record<string, unknown>,
        ledger: event.ledger,
        eventIndex: event.eventIndex,
      },
    });
  });
}

async function recordTransaction(event: ParsedEvent, campaignId: string | null) {
  await prisma.transaction.create({
    data: {
      campaignId,
      eventType: event.action,
      payload: event as unknown as Record<string, unknown>,
      ledger: event.ledger,
      eventIndex: event.eventIndex,
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertUser(tx: any, walletAddress: string, role: string) {
  await tx.user.upsert({
    where: { walletAddress },
    create: { walletAddress, role },
    update: {},
  });
}
