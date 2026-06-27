import type { CampaignStatus, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import logger from "../config/logger.js";
import { broadcast } from "../services/wsServer.js";
import { recordEventProcessed, recordEventDuplicate } from "./metrics.js";
import type {
  CampaignCreatedEvent,
  CampaignInvestedEvent,
  CampaignSettledEvent,
  DisputeOpenedEvent,
  DisputeEvidenceSubmittedEvent,
  DisputeResolvedEvent,
  DisputeDismissedEvent,
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
    const alreadyProcessed = await hasPersistedEvent(prisma, event.ledger, event.eventIndex);
    if (alreadyProcessed) {
      recordEventDuplicate();
      logDuplicateSkip(event, "persist.preflight");
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
      case "dispute.opened":
        await handleDisputeOpened(event as DisputeOpenedEvent);
        break;
      case "dispute.evidence_submitted":
        await handleDisputeEvidenceSubmitted(event as DisputeEvidenceSubmittedEvent);
        break;
      case "dispute.resolved":
        await handleDisputeResolved(event as DisputeResolvedEvent);
        break;
      case "dispute.dismissed":
        await handleDisputeDismissed(event as DisputeDismissedEvent);
        break;
      default:
        // Record the raw transaction but don't update domain models.
        await recordTransaction(event, null);
        return;
    }

    recordEventProcessed(event.action, event.ledger);
    logger.info("EventPersister: persisted", { action: event.action, ledger: event.ledger });
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleCampaignCreated(event: CampaignCreatedEvent) {
  // Idempotency: campaign upsert + transaction uniqueness guarantee safe replay.
  const deadlineTs = parseInt(event.deadline, 10);
  const deadline = Number.isFinite(deadlineTs)
    ? new Date(deadlineTs * 1000)
    : new Date(event.deadline);

  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;
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
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });
  });
}

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function hasPersistedEvent(
  client: Pick<typeof prisma, "transaction"> | Pick<TransactionClient, "transaction">,
  ledger: number,
  eventIndex: number,
) {
  const existing = await client.transaction.findUnique({
    where: { ledger_eventIndex: { ledger, eventIndex } },
  });
  return Boolean(existing);
}

async function skipDuplicateInTransaction(tx: TransactionClient, event: ParsedEvent) {
  const alreadyProcessed = await hasPersistedEvent(tx, event.ledger, event.eventIndex);
  if (alreadyProcessed) {
    logDuplicateSkip(event, "persist.tx");
    return true;
  }
  return false;
}

function logDuplicateSkip(event: ParsedEvent, stage: string) {
  logger.debug("EventPersister: skipping duplicate", {
    action: event.action,
    ledger: event.ledger,
    eventIndex: event.eventIndex,
    stage,
  });
}

async function handleCampaignInvested(event: CampaignInvestedEvent) {
  // Idempotency: investment upsert key includes campaign/investor/ledger.
  // Broadcast payloads are captured inside the transaction but sent only after
  // prisma.$transaction resolves (i.e. after the DB commit) so clients never
  // receive a notification for a rolled-back write.
  type PostCommitPayloads = {
    campaignInvested: {
      campaignId: string;
      investorAddress: string;
      amount: string;
      totalRaised: string;
      txHash: string | undefined;
    };
    investmentIndexed: {
      id: string;
      campaignId: string;
      investorAddress: string;
      amount: string;
      ledger: number;
      txHash: string | undefined;
      createdAt: string;
    };
  };
  let post: PostCommitPayloads | null = null;

  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;
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

    const inv = await tx.investment.upsert({
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
        txHash: event.txHash,
      },
      update: {},
    });

    await tx.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: event.action,
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });

    post = {
      campaignInvested: {
        campaignId: campaign.id,
        investorAddress: event.investor,
        amount: event.amount,
        totalRaised: event.totalRaised,
        txHash: event.txHash,
      },
      investmentIndexed: {
        id: inv.id,
        campaignId: campaign.id,
        investorAddress: inv.investorAddress,
        amount: inv.amount,
        ledger: inv.ledger,
        txHash: inv.txHash ?? undefined,
        createdAt: inv.createdAt.toISOString(),
      },
    };
  });

  if (post) {
    broadcast("campaign.invested", (post as PostCommitPayloads).campaignInvested);
    broadcast("investment.indexed", (post as PostCommitPayloads).investmentIndexed);
  }
}

async function handleCampaignSettled(event: CampaignSettledEvent) {
  // Idempotency: status/revenue overwrite plus transaction uniqueness prevents duplication.
  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;
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

    broadcast("campaign.settled", {
      campaignId: campaign.id,
      onChainId: event.campaignId,
      totalRevenue: event.totalRevenue,
    });

    await tx.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: event.action,
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });
  });
}

async function handleOrderCreated(event: OrderCreatedEvent) {
  // Idempotency: order upsert by onChainId makes duplicate create events safe.
  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;
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
        txHash: event.txHash,
      },
      update: {},
    });

    broadcast("order.created", {
      orderId: event.orderId,
      campaignId: campaign.id,
      buyerAddress: event.buyer,
      farmerAddress: campaign.farmerAddress,
      amount: event.amount,
      status: "PENDING",
      txHash: event.txHash,
    });

    await tx.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: event.action,
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });
  });
}

async function handleOrderConfirmed(event: OrderConfirmedEvent) {
  // Idempotency: duplicate confirms are dropped before order/revenue mutation.
  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;
    const order = await tx.order.findUnique({
      where: { onChainId: event.orderId },
    });
    if (!order) {
      logger.warn("EventPersister: confirm for unknown order", {
        orderId: event.orderId,
      });
      return;
    }

    await tx.order.update({
      where: { onChainId: event.orderId },
      data: { status: "CONFIRMED" },
    });

    // Prisma cannot add string-backed i128 values; calculate with BigInt and
    // write the exact decimal string once the authoritative event is indexed.
    const campaign = await tx.campaign.findUnique({ where: { id: order.campaignId } });
    if (campaign) {
      const prev = BigInt(campaign.totalRevenue);
      const added = BigInt(order.amount);
      await tx.campaign.update({
        where: { id: order.campaignId },
        data: { totalRevenue: String(prev + added) },
      });
    }

    broadcast("order.confirmed", {
      orderId: event.orderId,
      campaignId: order.campaignId,
      buyerAddress: event.buyer,
      status: "CONFIRMED",
      txHash: event.txHash,
    });

    await tx.transaction.create({
      data: {
        campaignId: order.campaignId,
        eventType: event.action,
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });
  });
}

async function updateCampaignStatus(
  event: GenericCampaignEvent,
  status: CampaignStatus,
) {
  // Idempotency: status transitions are deterministic for replayed lifecycle events.
  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;
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
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });
  });
}

async function recordTransaction(event: ParsedEvent, campaignId: string | null) {
  await prisma.transaction.create({
    data: {
      campaignId,
      eventType: event.action,
      payload: toEventPayload(event),
      ledger: event.ledger,
      eventIndex: event.eventIndex,
      txHash: event.txHash,
    },
  });
}

async function upsertUser(
  tx: Prisma.TransactionClient,
  walletAddress: string,
  role: string,
) {
  await tx.user.upsert({
    where: { walletAddress },
    create: { walletAddress, role },
    update: {},
  });
}

async function handleDisputeOpened(event: DisputeOpenedEvent) {
  // Idempotency: dispute upsert by transactionHash makes duplicate events safe.
  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;

    const campaign = await tx.campaign.findUnique({
      where: { onChainId: event.campaignId },
    });
    if (!campaign) {
      logger.warn("EventPersister: dispute for unknown campaign", {
        campaignId: event.campaignId,
      });
      return;
    }

    const dispute = await tx.dispute.upsert({
      where: { transactionHash: event.txHash! },
      create: {
        campaignId: campaign.id,
        orderId: event.orderId || undefined,
        initiatorAddress: event.initiatorAddress,
        respondentAddress: event.respondentAddress,
        transactionHash: event.txHash!,
        ledgerSequence: event.ledger,
        status: "Open",
      },
      update: {},
    });

    // Create audit entry for dispute opened
    await tx.disputeAuditEntry.create({
      data: {
        disputeId: dispute.id,
        action: "opened",
        actorAddress: event.initiatorAddress,
        details: { initiatorAddress: event.initiatorAddress },
      },
    });

    broadcast("dispute.opened", {
      disputeId: dispute.id,
      campaignId: campaign.id,
      orderId: event.orderId,
      initiatorAddress: event.initiatorAddress,
      respondentAddress: event.respondentAddress,
      status: "Open",
      txHash: event.txHash,
    });

    await tx.transaction.create({
      data: {
        campaignId: campaign.id,
        eventType: event.action,
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });
  });
}

async function handleDisputeEvidenceSubmitted(event: DisputeEvidenceSubmittedEvent) {
  // Idempotency: evidence upsert by transactionHash + evidence_submitted action.
  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;

    const dispute = await tx.dispute.findMany({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    if (!dispute.length) {
      logger.warn("EventPersister: evidence submitted for unknown dispute", {
        disputeId: event.disputeId,
      });
      return;
    }

    const currentDispute = dispute[0];

    // Create evidence record
    await tx.disputeEvidence.create({
      data: {
        disputeId: currentDispute.id,
        submitterAddress: event.submitterAddress,
        evidenceUrl: event.evidenceUrl,
        evidenceHash: event.evidenceHash,
      },
    });

    // Update dispute status to EvidenceSubmitted if it's Open
    if (currentDispute.status === "Open") {
      await tx.dispute.update({
        where: { id: currentDispute.id },
        data: { status: "EvidenceSubmitted" },
      });
    }

    // Create audit entry
    await tx.disputeAuditEntry.create({
      data: {
        disputeId: currentDispute.id,
        action: "evidence_submitted",
        actorAddress: event.submitterAddress,
        details: { evidenceHash: event.evidenceHash },
      },
    });

    broadcast("dispute.evidence_submitted", {
      disputeId: currentDispute.id,
      submitterAddress: event.submitterAddress,
      status: "EvidenceSubmitted",
      txHash: event.txHash,
    });

    await tx.transaction.create({
      data: {
        campaignId: currentDispute.campaignId,
        eventType: event.action,
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });
  });
}

async function handleDisputeResolved(event: DisputeResolvedEvent) {
  // Idempotency: status update is idempotent.
  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;

    const dispute = await tx.dispute.findMany({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    if (!dispute.length) {
      logger.warn("EventPersister: resolve event for unknown dispute", {
        disputeId: event.disputeId,
      });
      return;
    }

    const currentDispute = dispute[0];

    await tx.dispute.update({
      where: { id: currentDispute.id },
      data: {
        status: "Resolved",
        resolutionOutcome: event.resolutionOutcome,
        resolutionNotes: event.resolutionNotes,
      },
    });

    // Create audit entry
    await tx.disputeAuditEntry.create({
      data: {
        disputeId: currentDispute.id,
        action: "resolved",
        actorAddress: event.txHash || "system",
        details: { outcome: event.resolutionOutcome },
      },
    });

    broadcast("dispute.resolved", {
      disputeId: currentDispute.id,
      status: "Resolved",
      resolutionOutcome: event.resolutionOutcome,
      txHash: event.txHash,
    });

    await tx.transaction.create({
      data: {
        campaignId: currentDispute.campaignId,
        eventType: event.action,
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });
  });
}

async function handleDisputeDismissed(event: DisputeDismissedEvent) {
  // Idempotency: status update is idempotent.
  await prisma.$transaction(async (tx) => {
    if (await skipDuplicateInTransaction(tx, event)) return;

    const dispute = await tx.dispute.findMany({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    if (!dispute.length) {
      logger.warn("EventPersister: dismiss event for unknown dispute", {
        disputeId: event.disputeId,
      });
      return;
    }

    const currentDispute = dispute[0];

    await tx.dispute.update({
      where: { id: currentDispute.id },
      data: { status: "Dismissed" },
    });

    // Create audit entry
    await tx.disputeAuditEntry.create({
      data: {
        disputeId: currentDispute.id,
        action: "dismissed",
        actorAddress: event.txHash || "system",
        details: { reason: event.dismissalReason },
      },
    });

    broadcast("dispute.dismissed", {
      disputeId: currentDispute.id,
      status: "Dismissed",
      txHash: event.txHash,
    });

    await tx.transaction.create({
      data: {
        campaignId: currentDispute.campaignId,
        eventType: event.action,
        payload: toEventPayload(event),
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        txHash: event.txHash,
      },
    });
  });
}

/**
 * Serialize a parsed event into a Prisma-storable JSON payload. The round-trip
 * normalizes non-JSON values (e.g. the `timestamp` Date becomes an ISO string),
 * which is what Prisma would persist anyway.
 */
function toEventPayload(event: ParsedEvent): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue;
}
