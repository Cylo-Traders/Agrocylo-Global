import { scValToNative, xdr } from '@stellar/stellar-sdk';
import type { EventAction, ParsedEvent, RawSorobanEvent } from './types.js';
import logger from '../config/logger.js';
import { recordParseError } from './metrics.js';
import { validateEventSchema } from './schema.js';

/**
 * Decodes base64-encoded XDR ScVal topics and value from a raw Soroban event
 * into a typed ParsedEvent. Throws on unknown or malformed events so callers
 * can decide whether to skip or error.
 */
export class ProductionEventParser {
  static parse(raw: RawSorobanEvent): ParsedEvent {
    const topics = raw.topic.map(
      (t) => scValToNative(xdr.ScVal.fromXDR(t, 'base64')) as unknown,
    );

    if (topics.length < 2) {
      throw new Error(
        `Event ${raw.id}: expected ≥2 topics, got ${topics.length}`,
      );
    }

    const namespace = toEventString(topics[0]);
    const verb = toEventString(topics[1]);
    const action = `${namespace}.${verb}` as EventAction;

    let data: unknown[];
    try {
      const native = scValToNative(
        xdr.ScVal.fromXDR(raw.value, 'base64'),
      ) as unknown;
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
          campaignId: toEventString(data[0]),
          farmer: toEventString(data[1]),
          token: toEventString(data[2]),
          targetAmount: toEventString(data[3]),
          deadline: toEventString(data[4]),
        };

      case 'campaign.invested':
        return {
          ...base,
          action,
          campaignId: toEventString(data[0]),
          investor: toEventString(data[1]),
          amount: toEventString(data[2]),
          totalRaised: toEventString(data[3]),
        };

      case 'campaign.settled':
        return {
          ...base,
          action,
          campaignId: toEventString(data[0]),
          totalRevenue: toEventString(data[1]),
        };

      case 'order.created':
        return {
          ...base,
          action,
          orderId: toEventString(data[0]),
          buyer: toEventString(data[1]),
          campaignId: toEventString(data[2]),
          amount: toEventString(data[3]),
        };

      case 'order.confirmed':
        return {
          ...base,
          action,
          orderId: toEventString(data[0]),
          buyer: toEventString(data[1]),
          campaignId: toEventString(data[2]),
        };

      case 'dispute.opened':
        return {
          ...base,
          action,
          disputeId: toEventString(data[0]),
          campaignId: toEventString(data[1]),
          initiatorAddress: toEventString(data[2]),
          respondentAddress: toEventString(data[3]),
          orderId: data[4] === undefined ? undefined : toEventString(data[4]),
        };

      case 'dispute.evidence_submitted':
        return {
          ...base,
          action,
          disputeId: toEventString(data[0]),
          submitterAddress: toEventString(data[1]),
          evidenceUrl: toEventString(data[2]),
          evidenceHash: toEventString(data[3]),
        };

      case 'dispute.resolved':
        return {
          ...base,
          action,
          disputeId: toEventString(data[0]),
          resolutionOutcome: toEventString(data[1]),
          resolutionNotes:
            data[2] === undefined ? undefined : toEventString(data[2]),
        };

      case 'dispute.dismissed':
        return {
          ...base,
          action,
          disputeId: toEventString(data[0]),
          dismissalReason:
            data[1] === undefined ? undefined : toEventString(data[1]),
        };

      case 'basket.created':
        return {
          ...base,
          action,
          schemaVersion: toEventString(data[0]),
          basketId: toEventString(data[1]),
          constituentsCount: Number(data[2]),
          fundingDeadline:
            data[3] === undefined ? undefined : toEventString(data[3]),
          minDeposit:
            data[4] === undefined ? undefined : toEventString(data[4]),
        };

      case 'basket.deposit':
        return {
          ...base,
          action,
          schemaVersion: toEventString(data[0]),
          basketId: toEventString(data[1]),
          depositor: toEventString(data[2]),
          amount: toEventString(data[3]),
        };

      case 'basket.funded':
        return {
          ...base,
          action,
          schemaVersion: toEventString(data[0]),
          basketId: toEventString(data[1]),
          totalDeposit: toEventString(data[2]),
          totalInvested:
            data[3] === undefined ? undefined : toEventString(data[3]),
          totalSkipped:
            data[4] === undefined ? undefined : toEventString(data[4]),
        };

      case 'basket.fw_close':
        return {
          ...base,
          action,
          schemaVersion: toEventString(data[0]),
          basketId: toEventString(data[1]),
          fundingDeadline: toEventString(data[2]),
          minDeposit: toEventString(data[3]),
        };

      case 'basket.withdrawn':
        return {
          ...base,
          action,
          schemaVersion: toEventString(data[0]),
          basketId: toEventString(data[1]),
          depositor: toEventString(data[2]),
          depositAmount: toEventString(data[3]),
        };

      case 'basket.claimed':
        return {
          ...base,
          action,
          schemaVersion: toEventString(data[0]),
          basketId: toEventString(data[1]),
          depositor: toEventString(data[2]),
          payout: toEventString(data[3]),
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
          campaignId: toEventString(data[0]),
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

function toEventString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value === null || value === undefined) return '';
  return JSON.stringify(value) ?? '';
}

function parseEventIndex(id: string): number {
  const parts = id.split('-');
  return parts.length >= 2 ? parseInt(parts[1], 10) || 0 : 0;
}
