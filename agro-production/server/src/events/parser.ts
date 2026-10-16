import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type {
  EventAction,
  ParsedEvent,
  RawSorobanEvent,
} from "./types.js";
import logger from "../config/logger.js";
import { recordParseError } from "./metrics.js";
import { validateEventSchema, EVENT_SCHEMA_VERSION } from "./schema.js";

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

    let data: unknown[];
    try {
      const native = scValToNative(xdr.ScVal.fromXDR(raw.value, "base64"));
      data = Array.isArray(native) ? native : [native];
    } catch {
      throw new Error(`Event ${raw.id}: malformed value XDR`);
    }

    const validation = validateEventSchema(action, data);
    if (!validation.valid) {
      throw new Error(`Event ${raw.id}: schema validation failed - ${validation.reason}`);
    }

    const base = {
      ledger: raw.ledger,
      eventIndex: parseEventIndex(raw.id),
      timestamp: new Date(raw.ledgerClosedAt),
      rawId: raw.id,
      txHash: raw.txHash,
      schemaVersion: validation.version,
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

      case "basket.created":
        return {
          ...base,
          action,
          schemaVersion: String(data[0]),
          basketId: String(data[1]),
          constituentsCount: Number(data[2]),
          fundingDeadline: data[3] === undefined ? undefined : String(data[3]),
          minDeposit: data[4] === undefined ? undefined : String(data[4]),
        };

      case "basket.deposit":
        return {
          ...base,
          action,
          schemaVersion: String(data[0]),
          basketId: String(data[1]),
          depositor: String(data[2]),
          amount: String(data[3]),
        };

      case "basket.funded":
        return {
          ...base,
          action,
          schemaVersion: String(data[0]),
          basketId: String(data[1]),
          totalDeposit: String(data[2]),
          totalInvested: data[3] === undefined ? undefined : String(data[3]),
          totalSkipped: data[4] === undefined ? undefined : String(data[4]),
        };

      case "basket.fw_close":
        return {
          ...base,
          action,
          schemaVersion: String(data[0]),
          basketId: String(data[1]),
          fundingDeadline: String(data[2]),
          minDeposit: String(data[3]),
        };

      case "basket.withdrawn":
        return {
          ...base,
          action,
          schemaVersion: String(data[0]),
          basketId: String(data[1]),
          depositor: String(data[2]),
          depositAmount: String(data[3]),
        };

      case "basket.claimed":
        return {
          ...base,
          action,
          schemaVersion: String(data[0]),
          basketId: String(data[1]),
          depositor: String(data[2]),
          payout: String(data[3]),
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
      recordParseError();
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
