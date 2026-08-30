import { prisma } from "../../config/database.js";
import type { MappedEscrowEvent } from "../../types/escrowEvent.js";
import logger from "../../config/logger.js";
import { wsManager } from "../wsManager.js";

/**
 * @deprecated — Derived projection from canonical BlockchainTransaction.
 * Kept for backward compat / query convenience. New code should use
 * BlockchainEventPersistenceService + BlockchainTransaction (canonical table).
 * This service is NOT called by contractWatcher anymore; it remains
 * as a documented projection that can be rebuilt from BlockchainTransaction.
 *
 * Service responsible for projecting on-chain events into the application domain models.
 * This ensures the database reflecting Users, Products, and Orders is always up to date.
 */
export class EscrowEventProjectionService {
  /**
   * Projects a mapped escrow event into the domain tables.
   */
  static async projectEvent(parsed: MappedEscrowEvent): Promise<void> {
    const { action, buyer, seller, orderId, timestamp } = parsed;
    const eventDate = timestamp;
    // Canonicalize wallets for identity (single code path)
    const canonicalBuyer = buyer ? buyer.trim().toLowerCase() : buyer;
    const canonicalSeller = seller ? seller.trim().toLowerCase() : seller;

    try {
      // 1. Ensure Users exist (Buyers and Sellers) — via canonical identity
      if (canonicalBuyer) {
        await prisma.user.upsert({
          where: { walletAddress: canonicalBuyer },
          update: { role: "BUYER" },
          create: { walletAddress: canonicalBuyer, role: "BUYER" },
        });
        await prisma.profile.upsert({
          where: { walletAddress: canonicalBuyer },
          update: {},
          create: { walletAddress: canonicalBuyer, role: "BUYER" },
        });
      }

      if (canonicalSeller) {
        await prisma.user.upsert({
          where: { walletAddress: canonicalSeller },
          update: { role: "SELLER" },
          create: { walletAddress: canonicalSeller, role: "SELLER" },
        });
        await prisma.profile.upsert({
          where: { walletAddress: canonicalSeller },
          update: {},
          create: { walletAddress: canonicalSeller, role: "SELLER" },
        });
      }

      // Idempotent upsert keyed on [ledger, eventIndex] — replay safe
      await prisma.escrowTransaction.upsert({
        where: {
          ledger_eventIndex: {
            ledger: parsed.ledger,
            eventIndex: parsed.eventIndex,
          },
        },
        update: {},
        create: {
          orderIdOnChain: orderId,
          action: action.toUpperCase(),
          ledger: parsed.ledger,
          eventIndex: parsed.eventIndex,
          timestamp: eventDate,
        },
      });

      // 3. Map Actions to Domain States
      switch (action) {
        case "created":
          await this.handleOrderCreated(parsed, eventDate);
          break;
        case "delivered":
          await this.handleOrderDelivered(orderId);
          break;
        case "confirmed":
          await this.handleOrderConfirmed(orderId);
          break;
        case "refunded":
          await this.handleOrderRefunded(orderId);
          break;
        case "dispute":
          await this.handleOrderDisputed(orderId, parsed.buyer, eventDate);
          break;
        case "resolved":
          await this.handleOrderResolved(orderId, parsed.buyer === "REFUNDED", eventDate);
          break;
      }
    } catch (error) {
      logger.error(`Projection Error for ${action} on order ${orderId}:`, error);
    }
  }

  private static async handleOrderCreated(parsed: MappedEscrowEvent, eventDate: Date) {
    // Check if we can link a product based on the seller's wallet (canonical)
    const canonicalSeller = parsed.seller ? parsed.seller.trim().toLowerCase() : parsed.seller;
    const canonicalBuyer = parsed.buyer ? parsed.buyer.trim().toLowerCase() : parsed.buyer;
    const product = await prisma.product.findFirst({
      where: { farmerWallet: canonicalSeller },
    });

    await prisma.order.upsert({
      where: { orderIdOnChain: parsed.orderId },
      update: { status: "PENDING" },
      create: {
        orderIdOnChain: parsed.orderId,
        buyerAddress: canonicalBuyer!,
        sellerAddress: canonicalSeller!,
        amount: parsed.amount!,
        token: parsed.token!,
        status: "PENDING",
        productId: product?.id,
        createdAt: eventDate,
      } as any,
    });

    wsManager.broadcast("order:status_changed", {
      orderId: parsed.orderId,
      status: "PENDING",
      buyer: parsed.buyer,
      seller: parsed.seller,
      amount: parsed.amount,
      token: parsed.token,
    });

    // If product exists, we could also log this in price history
    if (product) {
      await prisma.priceHistory.create({
        data: {
          productId: product.id,
          price: parsed.amount!,
          currency: parsed.token!,
          timestamp: eventDate,
        },
      });
    }
  }

  private static async handleOrderDelivered(orderId: string) {
    try {
      await prisma.order.update({
        where: { orderIdOnChain: orderId },
        data: { status: "DELIVERED" },
      });
    } catch (e) {
      // Idempotent: if order not yet created (out-of-order projection), ignore — canonical pipeline handles placeholder
      if ((e as any)?.code !== "P2025") throw e;
      logger.warn(`[EscrowProjection] Delivered for missing order ${orderId} — ignored (canonical handles placeholder)`);
    }
  }

  private static async handleOrderConfirmed(orderId: string) {
    try {
      await prisma.order.update({
        where: { orderIdOnChain: orderId },
        data: { status: "COMPLETED" },
      });
    } catch (e) {
      if ((e as any)?.code !== "P2025") throw e;
      logger.warn(`[EscrowProjection] Confirmed for missing order ${orderId} — ignored`);
    }
    wsManager.broadcast("order:status_changed", {
      orderId,
      status: "COMPLETED",
    });
  }

  private static async handleOrderRefunded(orderId: string) {
    try {
      await prisma.order.update({
        where: { orderIdOnChain: orderId },
        data: { status: "REFUNDED" },
      });
    } catch (e) {
      if ((e as any)?.code !== "P2025") throw e;
      logger.warn(`[EscrowProjection] Refunded for missing order ${orderId} — ignored`);
    }
    wsManager.broadcast("order:status_changed", {
      orderId,
      status: "REFUNDED",
    });
  }

  private static async handleOrderDisputed(orderId: string, raisedBy: string, eventDate: Date) {
    await prisma.order.update({
      where: { orderIdOnChain: orderId },
      data: { status: "DISPUTED" },
    });

    await prisma.dispute.upsert({
      where: { orderIdOnChain: orderId },
      create: {
        orderIdOnChain: orderId,
        raisedBy,
        status: "OPEN",
        createdAt: eventDate,
      },
      update: {
        status: "OPEN",
        raisedBy,
      },
    });
  }

  private static async handleOrderResolved(orderId: string, isRefund: boolean, eventDate: Date) {
    await prisma.order.update({
      where: { orderIdOnChain: orderId },
      data: { status: isRefund ? "REFUNDED" : "COMPLETED" },
    });

    await prisma.dispute.update({
      where: { orderIdOnChain: orderId },
      data: {
        status: "RESOLVED",
        outcome: isRefund ? "REFUNDED" : "COMPLETED",
        resolvedAt: eventDate,
      },
    });
  }
}
