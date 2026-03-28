import type { ParsedEscrowEvent, MappedEscrowEvent } from "../../types/escrowEvent.js";

/**
 * EscrowEventMapper: Bridges pure parsed data with database-ready format.
 */
export class EscrowEventMapper {
  static mapToModel(parsed: ParsedEscrowEvent): MappedEscrowEvent {
    return {
      orderId: parsed.orderId,
      buyer: parsed.buyer,
      seller: parsed.seller || "N/A", // Map farmer to seller
      amount: parsed.amount,
      token: parsed.token || "unknown",
      action: parsed.action, // "CREATED", "CONFIRMED", "REFUNDED"
      ledger: parsed.ledger,
      eventIndex: parsed.eventIndex,
      timestamp: new Date(parsed.timestamp * 1000), // Convert ledger timestamp
    };
  }
}
