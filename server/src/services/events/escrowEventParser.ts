import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type { ParsedEscrowEvent } from "../../types/escrowEvent.js";

/**
 * EscrowEventParser: Pure utilities to extract data from raw Soroban events.
 */
export class EscrowEventParser {
  /**
   * Decodes a raw event from RPC into a structured ParsedEscrowEvent.
   * Based on contract lib.rs where events are emitted as:
   * (order, created) -> (order_id, buyer, farmer, amount, token)
   * (order, confirmed) -> (order_id, buyer, farmer)
   * (order, refunded) -> (order_id, buyer)
   */
  static parse(event: any): ParsedEscrowEvent {
    const topics = event.topic.map((t: string) =>
      scValToNative(xdr.ScVal.fromXDR(t, "base64")),
    );
    const action = topics[1]; // "created", "confirmed", "refunded"
    const data = scValToNative(xdr.ScVal.fromXDR(event.value, "base64"));

    const timestamp = parseInt(event.ledgerCloseAt) || Date.now();

    // Mapping based on action type
    const base = {
      action,
      ledger: event.ledger,
      eventIndex: parseInt(event.id.split('-')[1]) || 0, // Assuming standard 'ledger-index' format
      timestamp,
    };

    switch (action) {
      case "created":
        return {
          ...base,
          orderId: data[0].toString(),
          buyer: data[1],
          seller: data[2], // Mapping farmer to seller
          amount: data[3].toString(),
          token: data[4],
        };
      case "delivered":
        // Event: (order_id, farmer, buyer, delivery_timestamp)
        return {
          ...base,
          orderId: data[0].toString(),
          buyer: data[2],
          seller: data[1], // farmer is seller
          amount: "0", // Not in event
        };
      case "confirmed":
        return {
          ...base,
          orderId: data[0].toString(),
          buyer: data[1],
          seller: data[2],
          amount: "0", // Not in event
        };
      case "refunded":
        return {
          ...base,
          orderId: data[0].toString(),
          buyer: data[1],
          seller: "", // Not in event
          amount: "0", // Not in event
        };
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}
