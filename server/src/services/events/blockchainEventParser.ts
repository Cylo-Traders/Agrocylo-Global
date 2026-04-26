import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type { IndexedEvent, IndexedEventType } from "../../types/indexedEvent.js";

const SUPPORTED_EVENT_TYPES = new Set<IndexedEventType>([
  "campaign.created",
  "campaign.invested",
  "campaign.settled",
  "order.created",
  "order.confirmed",
]);

function toStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function toDateValue(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed > 1_000_000_000_000 ? parsed : parsed * 1000);
    }
  }
  return new Date();
}

function getEventIndex(eventId: string): number {
  const parts = eventId.split("-");
  const parsed = Number.parseInt(parts[1] ?? "", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export class BlockchainEventParser {
  static parse(rawEvent: {
    id: string;
    ledger: number;
    txHash?: string;
    ledgerCloseAt?: string | number;
    topic: string[];
    value: string;
  }): IndexedEvent | null {
    const topics = rawEvent.topic.map((entry) =>
      scValToNative(xdr.ScVal.fromXDR(entry, "base64")),
    );
    const value = scValToNative(xdr.ScVal.fromXDR(rawEvent.value, "base64"));
    return this.parseDecoded(topics, value, rawEvent);
  }

  static parseDecoded(
    topics: unknown[],
    value: unknown,
    meta: { id: string; ledger: number; txHash?: string; ledgerCloseAt?: string | number },
  ): IndexedEvent | null {
    const entity = toStringValue(topics[0])?.toLowerCase();
    const action = toStringValue(topics[1])?.toLowerCase();
    if (!entity || !action) return null;

    const eventType = `${entity}.${action}` as IndexedEventType;
    if (!SUPPORTED_EVENT_TYPES.has(eventType)) return null;

    const data = Array.isArray(value) ? value : [];
    const timestamp = toDateValue(meta.ledgerCloseAt);
    const common = {
      sourceEventId: meta.id,
      eventType,
      entity: entity as "campaign" | "order",
      action: action as "created" | "invested" | "settled" | "confirmed",
      ledger: meta.ledger,
      eventIndex: getEventIndex(meta.id),
      timestamp,
      txHash: meta.txHash,
      payload: value,
    };

    switch (eventType) {
      case "campaign.created":
        return {
          ...common,
          campaignIdOnChain: toStringValue(data[0]),
          actorAddress: toStringValue(data[1]),
          amount: toStringValue(data[2]),
          token: toStringValue(data[3]),
          status: "ACTIVE",
        };
      case "campaign.invested":
        return {
          ...common,
          campaignIdOnChain: toStringValue(data[0]),
          actorAddress: toStringValue(data[1]),
          amount: toStringValue(data[2]),
          token: toStringValue(data[3]),
        };
      case "campaign.settled":
        return {
          ...common,
          campaignIdOnChain: toStringValue(data[0]),
          actorAddress: toStringValue(data[1]),
          status: toStringValue(data[2]) ?? "SETTLED",
        };
      case "order.created":
        return {
          ...common,
          orderIdOnChain: toStringValue(data[0]),
          actorAddress: toStringValue(data[1]),
          secondaryAddress: toStringValue(data[2]),
          amount: toStringValue(data[3]),
          token: toStringValue(data[4]),
          status: "PENDING",
        };
      case "order.confirmed":
        return {
          ...common,
          orderIdOnChain: toStringValue(data[0]),
          actorAddress: toStringValue(data[1]),
          secondaryAddress: toStringValue(data[2]),
          status: "CONFIRMED",
        };
      default:
        return null;
    }
  }
}
