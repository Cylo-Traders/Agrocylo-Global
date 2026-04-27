import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type {
  EventAction,
  ParsedEvent,
  RawSorobanEvent,
} from "./types.js";
import logger from "../config/logger.js";

/**
 * Decodes base64-encoded XDR ScVal topics and value from a raw Soroban event
 * into a typed ParsedEvent. Throws on unknown or malformed events so callers
 * can decide whether to skip or error.
 */
export class ProductionEventParser {
  static parse(raw: RawSorobanEvent): ParsedEvent {
    const topics = raw.topic.map((t) =>
      scValToNative(xdr.ScVal.fromXDR(t, "base64")),
    );

    if (topics.length < 2) {
      throw new Error(`Event ${raw.id}: expected ≥2 topics, got ${topics.length}`);
    }

    const namespace: string = String(topics[0]);
    const verb: string = String(topics[1]);
    const action = `${namespace}.${verb}` as EventAction;

    const data: unknown[] = (() => {
      try {
        const native = scValToNative(xdr.ScVal.fromXDR(raw.value, "base64"));
        return Array.isArray(native) ? native : [native];
      } catch {
        return [];
      }
    })();

    const base = {
      ledger: raw.ledger,
      eventIndex: parseEventIndex(raw.id),
      timestamp: new Date(raw.ledgerClosedAt),
      rawId: raw.id,
    };

    switch (action) {
      case "campaign.created":
        return {
          ...base,
          action,
          campaignId: String(data[0]),
          farmer: String(data[1]),
          token: String(data[2]),
          targetAmount: String(data[3]),
          deadline: String(data[4]),
        };

      case "campaign.invested":
        return {
          ...base,
          action,
          campaignId: String(data[0]),
          investor: String(data[1]),
          amount: String(data[2]),
          totalRaised: String(data[3]),
        };

      case "campaign.settled":
        return {
          ...base,
          action,
          campaignId: String(data[0]),
          totalRevenue: String(data[1]),
        };

      case "order.created":
        return {
          ...base,
          action,
          orderId: String(data[0]),
          buyer: String(data[1]),
          campaignId: String(data[2]),
          amount: String(data[3]),
        };

      case "order.confirmed":
        return {
          ...base,
          action,
          orderId: String(data[0]),
          buyer: String(data[1]),
          campaignId: String(data[2]),
        };

      case "campaign.produce":
      case "campaign.harvest":
      case "campaign.failed":
      case "campaign.disputed":
      case "campaign.claimed":
      case "campaign.refunded":
      case "campaign.tranche":
        return {
          ...base,
          action,
          campaignId: String(data[0]),
          extra: data.slice(1),
        };

      default:
        throw new Error(`ProductionEventParser: unknown action "${action}" in event ${raw.id}`);
    }
  }

  /** Parse and swallow errors — returns null on invalid events. */
  static tryParse(raw: RawSorobanEvent): ParsedEvent | null {
    try {
      return ProductionEventParser.parse(raw);
    } catch (err) {
      logger.warn("ProductionEventParser: skipping malformed event", {
        id: raw.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

function parseEventIndex(id: string): number {
  const parts = id.split("-");
  return parts.length >= 2 ? parseInt(parts[1], 10) || 0 : 0;
}
