import { prisma } from "../../config/database.js";
import type { ParsedEscrowEvent } from "../../types/escrowEvent.js";
import logger from "../../config/logger.js";
import { wsManager } from "../wsManager.js";

/**
 * Service responsible for projecting on-chain events into the application domain models.
 * This ensures the database reflecting Users, Products, and Orders is always up to date.
 */
export class EscrowEventProjectionService {
  /**
   * Projects a parsed event into the domain tables.
   */
  static async projectEvent(parsed: any): Promise<void> {
    const { action, buyer, seller, orderId, amount, token, timestamp } = parsed;
    const eventDate = timestamp instanceof Date ? timestamp : new Date(timestamp * 1000);

    try {
      // 1. Ensure Users exist (Buyers and Sellers)
      // We use upsert to create them if they don't exist yet
      if (buyer) {
        await prisma.user.upsert({
          where: { walletAddress: buyer },
          update: { role: "BUYER" },
          create: { walletAddress: buyer, role: "BUYER" },
        });
      }

      if (seller) {
        await prisma.user.upsert({
          where: { walletAddress: seller },
          update: { role: "SELLER" },
          create: { walletAddress: seller, role: "SELLER" },
        });
      }


      await prisma.escrowTransaction.create({
        data: {
          orderIdOnChain: orderId,
          action: action.toUpperCase(),
          ledger: parsed.ledger,
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

  private static async handleOrderCreated(parsed: ParsedEscrowEvent, eventDate: Date) {
    // Check if we can link a product based on the seller's wallet
    const product = await prisma.product.findFirst({
      where: { farmerWallet: parsed.seller },
    });

    await prisma.order.upsert({
      where: { orderIdOnChain: parsed.orderId },
      update: { status: "PENDING" },
      create: {
        orderIdOnChain: parsed.orderId,
        buyerAddress: parsed.buyer!,
        sellerAddress: parsed.seller!,
        amount: parsed.amount!,
        token: parsed.token!,
        status: "PENDING",
        productId: product?.id,
        createdAt: eventDate,
      },
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
    await prisma.order.update({
      where: { orderIdOnChain: orderId },
      data: { status: "DELIVERED" },
    });
  }

  private static async handleOrderConfirmed(orderId: string) {
    await prisma.order.update({
      where: { orderIdOnChain: orderId },
      data: { status: "COMPLETED" },
    });
    wsManager.broadcast("order:status_changed", {
      orderId,
      status: "COMPLETED",
    });
  }

  private static async handleOrderRefunded(orderId: string) {
    await prisma.order.update({
      where: { orderIdOnChain: orderId },
      data: { status: "REFUNDED" },
    });
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
