import { scValToNative } from '@stellar/stellar-sdk';
import type { IndexedEvent, IndexedEventType } from '../../types/indexedEvent.js';
import type { RawRpcEvent } from '../../types/rawRpcEvent.js';

const SUPPORTED_EVENT_TYPES = new Set<IndexedEventType>(['basket.funded', 'basket.skipped']);

function toStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function toDateValue(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    return new Date(value > 1_000_000_000_000 ? value : value * 1000);
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed > 1_000_000_000_000 ? parsed : parsed * 1000);
    }
  }
  return new Date();
}

function getEventIndex(eventId: string): number {
  const parsed = Number.parseInt(eventId.split('-')[1] ?? '', 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export class BasketEventParser {
  static parse(rawEvent: RawRpcEvent): IndexedEvent | null {
    const topics = rawEvent.topic.map((t) => scValToNative(t));
    const value = scValToNative(rawEvent.value);
    return this.parseDecoded(topics, value, rawEvent);
  }

  static parseDecoded(
    topics: unknown[],
    value: unknown,
    meta: { id: string; ledger: number; txHash?: string; ledgerClosedAt?: string | number }
  ): IndexedEvent | null {
    const entity = toStringValue(topics[0])?.toLowerCase();
    const action = toStringValue(topics[1])?.toLowerCase();
    if (!entity || !action) return null;

    const eventType = `${entity}.${action}` as IndexedEventType;
    if (!SUPPORTED_EVENT_TYPES.has(eventType)) return null;

    const data = Array.isArray(value) ? value : [];
    const timestamp = toDateValue(meta.ledgerClosedAt);
    const common = {
      sourceEventId: meta.id,
      eventType,
      entity: entity as IndexedEvent['entity'],
      action: action as IndexedEvent['action'],
      ledger: meta.ledger,
      eventIndex: getEventIndex(meta.id),
      timestamp,
      txHash: meta.txHash,
      payload: value,
    };

    switch (eventType) {
      // Contract: publish((basket, funded), (schema_version, basket_id, total_deposit, total_invested, total_skipped))
      case 'basket.funded':
        return {
          ...common,
          schemaVersion: toStringValue(data[0]),
          basketIdOnChain: toStringValue(data[1]),
          amount: toStringValue(data[2]),
          totalInvested: toStringValue(data[3]),
          totalSkipped: toStringValue(data[4]),
        };

      // Contract: publish((basket, skipped), (schema_version, basket_id, campaign_id, share))
      case 'basket.skipped':
        return {
          ...common,
          schemaVersion: toStringValue(data[0]),
          basketIdOnChain: toStringValue(data[1]),
          campaignIdOnChain: toStringValue(data[2]),
          amount: toStringValue(data[3]),
        };

      default:
        return null;
    }
  }
}
