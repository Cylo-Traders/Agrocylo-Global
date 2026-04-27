import { prisma } from "../../config/database.js";
import logger from "../../config/logger.js";
import type { IndexedEvent } from "../../types/indexedEvent.js";

export class BlockchainEventPersistenceService {
  static async persist(event: IndexedEvent): Promise<void> {
    try {
      const db = prisma as any;
      const existing = await db.blockchainTransaction.findUnique({
        where: { sourceEventId: event.sourceEventId },
      });
      if (existing) return;

      await db.$transaction(async (tx: any) => {
        await this.upsertUsers(tx, event);
        await this.projectEntity(tx, event);
        await tx.blockchainTransaction.create({
          data: {
            sourceEventId: event.sourceEventId,
            eventType: event.eventType,
            entity: event.entity,
            action: event.action,
            ledger: event.ledger,
            eventIndex: event.eventIndex,
            txHash: event.txHash ?? null,
            campaignIdOnChain: event.campaignIdOnChain ?? null,
            orderIdOnChain: event.orderIdOnChain ?? null,
            payload: event.payload,
            createdAt: event.timestamp,
          },
        });
      });
    } catch (error) {
      logger.error("Failed to persist indexed blockchain event", { event, error });
      throw error;
    }
  }

  private static async upsertUsers(tx: any, event: IndexedEvent): Promise<void> {
    const addresses = [event.actorAddress, event.secondaryAddress].filter(
      (address): address is string => Boolean(address),
    );
    for (const walletAddress of addresses) {
      await tx.user.upsert({
        where: { walletAddress },
        update: {},
        create: { walletAddress },
      });
    }
  }

  private static async projectEntity(tx: any, event: IndexedEvent): Promise<void> {
    switch (event.eventType) {
      case "campaign.created":
        await tx.campaign.upsert({
          where: { campaignIdOnChain: event.campaignIdOnChain },
          update: {
            creatorAddress: event.actorAddress ?? "",
            goalAmount: event.amount ?? "0",
            token: event.token ?? "",
            status: "ACTIVE",
          },
          create: {
            campaignIdOnChain: event.campaignIdOnChain ?? "",
            creatorAddress: event.actorAddress ?? "",
            goalAmount: event.amount ?? "0",
            token: event.token ?? "",
            status: "ACTIVE",
          },
        });
        return;
      case "campaign.invested":
        await tx.campaign.upsert({
          where: { campaignIdOnChain: event.campaignIdOnChain },
          update: {},
          create: {
            campaignIdOnChain: event.campaignIdOnChain ?? "",
            creatorAddress: "",
            goalAmount: "0",
            token: event.token ?? "",
            status: "ACTIVE",
          },
        });
        await tx.investment.upsert({
          where: { sourceEventId: event.sourceEventId },
          update: {},
          create: {
            sourceEventId: event.sourceEventId,
            campaignIdOnChain: event.campaignIdOnChain ?? "",
            investorAddress: event.actorAddress ?? "",
            amount: event.amount ?? "0",
            token: event.token ?? "",
            txHash: event.txHash ?? null,
            createdAt: event.timestamp,
          },
        });
        return;
      case "campaign.settled":
        await tx.campaign.upsert({
          where: { campaignIdOnChain: event.campaignIdOnChain },
          update: { status: event.status ?? "SETTLED" },
          create: {
            campaignIdOnChain: event.campaignIdOnChain ?? "",
            creatorAddress: event.actorAddress ?? "",
            goalAmount: "0",
            token: event.token ?? "",
            status: event.status ?? "SETTLED",
          },
        });
        return;
      case "order.created":
        await tx.order.upsert({
          where: { orderIdOnChain: event.orderIdOnChain },
          update: {
            buyerAddress: event.actorAddress ?? "",
            sellerAddress: event.secondaryAddress ?? "",
            amount: event.amount ?? "0",
            token: event.token ?? "",
            status: "PENDING",
          },
          create: {
            orderIdOnChain: event.orderIdOnChain ?? "",
            buyerAddress: event.actorAddress ?? "",
            sellerAddress: event.secondaryAddress ?? "",
            amount: event.amount ?? "0",
            token: event.token ?? "",
            status: "PENDING",
          },
        });
        return;
      case "order.delivered":
        await tx.order.upsert({
          where: { orderIdOnChain: event.orderIdOnChain },
          update: { status: "DELIVERED" },
          create: {
            orderIdOnChain: event.orderIdOnChain ?? "",
            buyerAddress: event.secondaryAddress ?? "", // buyer is secondaryAddress for delivered
            sellerAddress: event.actorAddress ?? "",    // farmer is actorAddress for delivered
            amount: "0",
            token: "",
            status: "DELIVERED",
          },
        });
        return;
      case "order.confirmed":
        await tx.order.upsert({
          where: { orderIdOnChain: event.orderIdOnChain },
          update: { status: "COMPLETED" },
          create: {
            orderIdOnChain: event.orderIdOnChain ?? "",
            buyerAddress: event.actorAddress ?? "",
            sellerAddress: event.secondaryAddress ?? "",
            amount: "0",
            token: "",
            status: "COMPLETED",
          },
        });
        return;
      case "order.refunded":
        await tx.order.upsert({
          where: { orderIdOnChain: event.orderIdOnChain },
          update: { status: "REFUNDED" },
          create: {
            orderIdOnChain: event.orderIdOnChain ?? "",
            buyerAddress: event.actorAddress ?? "",
            sellerAddress: "",
            amount: "0",
            token: "",
            status: "REFUNDED",
          },
        });
        return;
      default:
        return;
    }
  }
}
