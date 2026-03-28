import { prisma } from "../../config/database.js";
import type { MappedEscrowEvent } from "../../types/escrowEvent.js";
import logger from "../../config/logger.js";

/**
 * EscrowEventRepository: DB persistence logic.
 */
export class EscrowEventRepository {
  /**
   * Upsert an escrow event index record.
   * Uses ledger + eventIndex as unique composite key.
   */
  static async createEscrowEvent(mapped: MappedEscrowEvent) {
    try {
      return await prisma.escrowEvent.upsert({
        where: {
          ledger_eventIndex: {
            ledger: mapped.ledger,
            eventIndex: mapped.eventIndex,
          },
        },
        update: {}, // No-op if it already exists
        create: {
          orderId: mapped.orderId,
          buyer: mapped.buyer,
          seller: mapped.seller,
          amount: mapped.amount,
          token: mapped.token,
          action: mapped.action,
          ledger: mapped.ledger,
          eventIndex: mapped.eventIndex,
          timestamp: mapped.timestamp,
        },
      });
    } catch (error) {
      logger.error("Database Create Error (EscrowEvent):", error);
      throw error;
    }
  }
}
