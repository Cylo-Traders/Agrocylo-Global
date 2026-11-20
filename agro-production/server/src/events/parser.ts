import { scValToNative, xdr } from '@stellar/stellar-sdk';
import type { EventAction, ParsedEvent, RawSorobanEvent } from './types.js';
import logger from '../config/logger.js';
import { recordParseError } from './metrics.js';
import { validateEventSchema } from './schema.js';

function toStr(val: unknown): string {
  if (
    typeof val === 'string' ||
    typeof val === 'number' ||
    typeof val === 'bigint' ||
    typeof val === 'boolean'
  ) {
    return String(val);
  }
  return JSON.stringify(val ?? '');
}

function toOptStr(val: unknown): string | undefined {
  return val === undefined ? undefined : toStr(val);
}

/**
 * Decodes base64-encoded XDR ScVal topics and value from a raw Soroban event
 * into a typed ParsedEvent. Throws on unknown or malformed events so callers
 * can decide whether to skip or error.
 */
export class ProductionEventParser {
  static parse(raw: RawSorobanEvent): ParsedEvent {
    const topics: unknown[] = raw.topic.map((t): unknown =>
      scValToNative(xdr.ScVal.fromXDR(t, 'base64')),
    );

    if (topics.length < 2) {
      throw new Error(
        `Event ${raw.id}: expected ≥2 topics, got ${topics.length}`,
      );
    }

    const namespace: string = toStr(topics[0]);
    const verb: string = toStr(topics[1]);
    const action = `${namespace}.${verb}` as EventAction;

    let data: unknown[];
    try {
      const native: unknown = scValToNative(
        xdr.ScVal.fromXDR(raw.value, 'base64'),
      );
      data = Array.isArray(native) ? (native as unknown[]) : [native];
    } catch {
      throw new Error(`Event ${raw.id}: malformed value XDR`);
    }

    const validation = validateEventSchema(action, data);
    if (!validation.valid) {
      throw new Error(
        `Event ${raw.id}: schema validation failed - ${validation.reason}`,
      );
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
      case 'campaign.created':
        return {
          ...base,
          action,
          campaignId: String(data[0]),
          farmer: String(data[1]),
          token: String(data[2]),
          targetAmount: String(data[3]),
          deadline: String(data[4]),
        };

      case 'campaign.invested':
        return {
          ...base,
          action,
          campaignId: String(data[0]),
          investor: String(data[1]),
          amount: String(data[2]),
          totalRaised: String(data[3]),
        };

      case 'campaign.settled':
        return {
          ...base,
          action,
          campaignId: String(data[0]),
          totalRevenue: String(data[1]),
        };

      case 'order.created':
        return {
          ...base,
          action,
          orderId: String(data[0]),
          buyer: String(data[1]),
          campaignId: String(data[2]),
          amount: String(data[3]),
        };

      case 'order.confirmed':
        return {
          ...base,
          action,
          orderId: String(data[0]),
          buyer: String(data[1]),
          campaignId: String(data[2]),
        };

      case 'dispute.opened':
        return {
          ...base,
          action,
          disputeId: toStr(data[0]),
          campaignId: toStr(data[1]),
          initiatorAddress: toStr(data[2]),
          respondentAddress: toStr(data[3]),
          orderId: toOptStr(data[4]),
        };

      case 'dispute.evidence_submitted':
        return {
          ...base,
          action,
          disputeId: toStr(data[0]),
          submitterAddress: toStr(data[1]),
          evidenceUrl: toStr(data[2]),
          evidenceHash: toStr(data[3]),
        };

      case 'dispute.resolved':
        return {
          ...base,
          action,
          disputeId: toStr(data[0]),
          resolutionOutcome: toStr(data[1]),
          resolutionNotes: toOptStr(data[2]),
        };

      case 'dispute.dismissed':
        return {
          ...base,
          action,
          disputeId: toStr(data[0]),
          dismissalReason: toOptStr(data[1]),
        };

      case 'basket.created':
        return {
          ...base,
          action,
          schemaVersion: toStr(data[0]),
          basketId: toStr(data[1]),
          constituentsCount: Number(data[2]),
          fundingDeadline: toOptStr(data[3]),
          minDeposit: toOptStr(data[4]),
        };

      case 'basket.deposit':
        return {
          ...base,
          action,
          schemaVersion: toStr(data[0]),
          basketId: toStr(data[1]),
          depositor: toStr(data[2]),
          amount: toStr(data[3]),
        };

      case 'basket.funded':
        return {
          ...base,
          action,
          schemaVersion: toStr(data[0]),
          basketId: toStr(data[1]),
          totalDeposit: toStr(data[2]),
          totalInvested: toOptStr(data[3]),
          totalSkipped: toOptStr(data[4]),
        };

      case 'basket.fw_close':
        return {
          ...base,
          action,
          schemaVersion: toStr(data[0]),
          basketId: toStr(data[1]),
          fundingDeadline: toStr(data[2]),
          minDeposit: toStr(data[3]),
        };

      case 'basket.withdrawn':
        return {
          ...base,
          action,
          schemaVersion: toStr(data[0]),
          basketId: toStr(data[1]),
          depositor: toStr(data[2]),
          depositAmount: toStr(data[3]),
        };

      case 'basket.claimed':
        return {
          ...base,
          action,
          schemaVersion: toStr(data[0]),
          basketId: toStr(data[1]),
          depositor: toStr(data[2]),
          payout: toStr(data[3]),
        };

      case 'campaign.produce':
      case 'campaign.harvest':
      case 'campaign.failed':
      case 'campaign.disputed':
      case 'campaign.claimed':
      case 'campaign.refunded':
      case 'campaign.tranche':
        return {
          ...base,
          action,
          campaignId: toStr(data[0]),
          extra: data.slice(1),
        };

      default:
        throw new Error(
          `ProductionEventParser: unknown action "${String(action)}" in event ${raw.id}`,
        );
    }
  }

  /** Parse and swallow errors — returns null on invalid events. */
  static tryParse(raw: RawSorobanEvent): ParsedEvent | null {
    try {
      return ProductionEventParser.parse(raw);
    } catch (err) {
      recordParseError();
      logger.warn('ProductionEventParser: skipping malformed event', {
        id: raw.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

function parseEventIndex(id: string): number {
  const parts = id.split('-');
  return parts.length >= 2 ? parseInt(parts[1], 10) || 0 : 0;
}
