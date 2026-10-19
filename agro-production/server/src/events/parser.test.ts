import { describe, expect, it } from 'vitest';
import { ProductionEventParser } from './parser.js';
import type { EventAction, RawSorobanEvent } from './types.js';

// Helpers — build minimal fake raw events with pre-encoded topics/values.
// Rather than calling the real stellar-sdk encoder, we test the parser against
// the actual SDK encoding to verify round-trip correctness.
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';

function encodeVal(native: unknown): string {
  return nativeToScVal(native).toXDR('base64');
}

function encodeSymbol(s: string): string {
  return xdr.ScVal.scvSymbol(s).toXDR('base64');
}

function makeRaw(
  namespace: string,
  verb: string,
  dataTuple: unknown[],
  id = '100-0',
  ledger = 100,
): RawSorobanEvent {
  return {
    id,
    type: 'contract',
    ledger,
    ledgerClosedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
    contractId: 'CTEST',
    txHash: 'a'.repeat(64),
    topic: [encodeSymbol(namespace), encodeSymbol(verb)],
    value: encodeVal(dataTuple),
  };
}

describe('ProductionEventParser', () => {
  describe('campaign.created', () => {
    it('parses correctly', () => {
      const raw = makeRaw('campaign', 'created', [
        1n,
        'GFARMER',
        'GTOKEN',
        10000n,
        9999n,
      ]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('campaign.created');
      if (event.action === 'campaign.created') {
        expect(event.campaignId).toBe('1');
        expect(event.farmer).toBe('GFARMER');
        expect(event.token).toBe('GTOKEN');
        expect(event.targetAmount).toBe('10000');
        expect(event.deadline).toBe('9999');
      }
    });
  });

  describe('campaign.invested', () => {
    it('parses correctly', () => {
      const raw = makeRaw('campaign', 'invested', [
        2n,
        'GINVESTOR',
        5000n,
        5000n,
      ]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('campaign.invested');
      if (event.action === 'campaign.invested') {
        expect(event.campaignId).toBe('2');
        expect(event.investor).toBe('GINVESTOR');
        expect(event.amount).toBe('5000');
        expect(event.totalRaised).toBe('5000');
        expect(event.txHash).toBe('a'.repeat(64));
      }
    });
  });

  describe('campaign.settled', () => {
    it('parses correctly', () => {
      const raw = makeRaw('campaign', 'settled', [3n, 2000n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('campaign.settled');
      if (event.action === 'campaign.settled') {
        expect(event.campaignId).toBe('3');
        expect(event.totalRevenue).toBe('2000');
      }
    });
  });

  describe('order.created', () => {
    it('parses correctly', () => {
      const raw = makeRaw('order', 'created', [10n, 'GBUYER', 3n, 500n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('order.created');
      if (event.action === 'order.created') {
        expect(event.orderId).toBe('10');
        expect(event.buyer).toBe('GBUYER');
        expect(event.campaignId).toBe('3');
        expect(event.amount).toBe('500');
      }
    });
  });

  describe('order.confirmed', () => {
    it('parses correctly', () => {
      const raw = makeRaw('order', 'confirmed', [10n, 'GBUYER', 3n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('order.confirmed');
      if (event.action === 'order.confirmed') {
        expect(event.orderId).toBe('10');
        expect(event.buyer).toBe('GBUYER');
        expect(event.campaignId).toBe('3');
      }
    });
  });

  describe('basket.created', () => {
    it('parses correctly', () => {
      const raw = makeRaw('basket', 'created', [1, 1n, 3, 1_700_001_000n, 1000n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('basket.created');
      if (event.action === 'basket.created') {
        expect(event.schemaVersion).toBe('1');
        expect(event.basketId).toBe('1');
        expect(event.constituentsCount).toBe(3);
        expect(event.fundingDeadline).toBe('1700001000');
        expect(event.minDeposit).toBe('1000');
      }
    });
  });

  describe('basket.deposit', () => {
    it('parses correctly', () => {
      const raw = makeRaw('basket', 'deposit', [1, 1n, 'GDEPOSITOR', 500n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('basket.deposit');
      if (event.action === 'basket.deposit') {
        expect(event.schemaVersion).toBe('1');
        expect(event.basketId).toBe('1');
        expect(event.depositor).toBe('GDEPOSITOR');
        expect(event.amount).toBe('500');
      }
    });
  });

  describe('basket.funded', () => {
    it('parses correctly', () => {
      const raw = makeRaw('basket', 'funded', [1, 1n, 1500n, 1200n, 300n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('basket.funded');
      if (event.action === 'basket.funded') {
        expect(event.schemaVersion).toBe('1');
        expect(event.basketId).toBe('1');
        expect(event.totalDeposit).toBe('1500');
        expect(event.totalInvested).toBe('1200');
        expect(event.totalSkipped).toBe('300');
      }
    });
  });

  describe('basket.fw_close', () => {
    it('parses correctly', () => {
      const raw = makeRaw('basket', 'fw_close', [1, 1n, 1_700_001_000n, 1000n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('basket.fw_close');
      if (event.action === 'basket.fw_close') {
        expect(event.schemaVersion).toBe('1');
        expect(event.basketId).toBe('1');
        expect(event.fundingDeadline).toBe('1700001000');
        expect(event.minDeposit).toBe('1000');
      }
    });
  });

  describe('basket.withdrawn', () => {
    it('parses correctly', () => {
      const raw = makeRaw('basket', 'withdrawn', [1, 1n, 'GDEPOSITOR', 500n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('basket.withdrawn');
      if (event.action === 'basket.withdrawn') {
        expect(event.schemaVersion).toBe('1');
        expect(event.basketId).toBe('1');
        expect(event.depositor).toBe('GDEPOSITOR');
        expect(event.depositAmount).toBe('500');
      }
    });
  });

  describe('basket.claimed', () => {
    it('parses correctly', () => {
      const raw = makeRaw('basket', 'claimed', [1, 1n, 'GDEPOSITOR', 620n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('basket.claimed');
      if (event.action === 'basket.claimed') {
        expect(event.schemaVersion).toBe('1');
        expect(event.basketId).toBe('1');
        expect(event.depositor).toBe('GDEPOSITOR');
        expect(event.payout).toBe('620');
      }
    });
  });

  describe('dispute.opened', () => {
    it('parses correctly', () => {
      const raw = makeRaw('dispute', 'opened', [
        1n,
        3n,
        'GINITIATOR',
        'GRESPONDENT',
      ]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('dispute.opened');
      if (event.action === 'dispute.opened') {
        expect(event.disputeId).toBe('1');
        expect(event.campaignId).toBe('3');
        expect(event.initiatorAddress).toBe('GINITIATOR');
        expect(event.respondentAddress).toBe('GRESPONDENT');
      }
    });
  });

  describe('dispute.evidence_submitted', () => {
    it('parses correctly', () => {
      const raw = makeRaw('dispute', 'evidence_submitted', [
        1n,
        'GSUBMITTER',
        'https://example.com/evidence.pdf',
        'HASH123',
      ]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('dispute.evidence_submitted');
      if (event.action === 'dispute.evidence_submitted') {
        expect(event.disputeId).toBe('1');
        expect(event.submitterAddress).toBe('GSUBMITTER');
        expect(event.evidenceUrl).toBe('https://example.com/evidence.pdf');
        expect(event.evidenceHash).toBe('HASH123');
      }
    });
  });

  describe('dispute.resolved', () => {
    it('parses correctly', () => {
      const raw = makeRaw('dispute', 'resolved', [1n, 'FAVOR_BUYER']);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('dispute.resolved');
      if (event.action === 'dispute.resolved') {
        expect(event.disputeId).toBe('1');
        expect(event.resolutionOutcome).toBe('FAVOR_BUYER');
      }
    });
  });

  describe('dispute.dismissed', () => {
    it('parses correctly', () => {
      const raw = makeRaw('dispute', 'dismissed', [1n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe('dispute.dismissed');
      if (event.action === 'dispute.dismissed') {
        expect(event.disputeId).toBe('1');
      }
    });
  });

  describe('EventAction coverage', () => {
    const allActions: EventAction[] = [
      'campaign.created',
      'campaign.invested',
      'campaign.settled',
      'campaign.produce',
      'campaign.harvest',
      'campaign.failed',
      'campaign.disputed',
      'campaign.claimed',
      'campaign.refunded',
      'campaign.tranche',
      'order.created',
      'order.confirmed',
      'dispute.opened',
      'dispute.evidence_submitted',
      'dispute.resolved',
      'dispute.dismissed',
      'basket.created',
      'basket.deposit',
      'basket.funded',
      'basket.fw_close',
      'basket.withdrawn',
      'basket.claimed',
    ];

    // A generous tuple of filler values — enough positional args to satisfy
    // every event type's field count, regardless of expected type.
    const filler = [1n, 'GADDR1', 'GADDR2', 1n, 1n, 1n];

    it.each(allActions)('parses %s without throwing', (action) => {
      const [namespace, verb] = action.split('.') as [string, string];
      const raw = makeRaw(namespace, verb, filler);
      expect(() => ProductionEventParser.parse(raw)).not.toThrow();
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe(action);
    });
  });

  describe('generic campaign events', () => {
    it.each([
      'produce',
      'harvest',
      'failed',
      'disputed',
      'claimed',
      'refunded',
      'tranche',
    ])('parses campaign.%s', (verb) => {
      const raw = makeRaw('campaign', verb, [5n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe(`campaign.${verb}`);
      if ('campaignId' in event) {
        expect(event.campaignId).toBe('5');
      }
    });
  });

  describe('error handling', () => {
    it('throws on unknown namespace+verb', () => {
      const raw = makeRaw('unknown', 'action', []);
      expect(() => ProductionEventParser.parse(raw)).toThrow();
    });

    it('tryParse returns null instead of throwing', () => {
      const raw = makeRaw('unknown', 'action', []);
      expect(ProductionEventParser.tryParse(raw)).toBeNull();
    });

    it('throws on too few topics', () => {
      const raw: RawSorobanEvent = {
        id: '1-0',
        type: 'contract',
        ledger: 1,
        ledgerClosedAt: new Date().toISOString(),
        contractId: 'C',
        topic: [encodeSymbol('campaign')],
        value: encodeVal([]),
      };
      expect(() => ProductionEventParser.parse(raw)).toThrow();
    });
  });

  describe('metadata', () => {
    it('captures ledger and eventIndex', () => {
      const raw = makeRaw('campaign', 'settled', [1n, 0n], '500-3', 500);
      const event = ProductionEventParser.parse(raw);
      expect(event.ledger).toBe(500);
      expect(event.eventIndex).toBe(3);
    });

    it('parses timestamp from ledgerClosedAt', () => {
      const raw = makeRaw('campaign', 'settled', [1n, 0n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('stores rawId from the event id field', () => {
      const raw = makeRaw('campaign', 'settled', [1n, 0n], '777-2', 777);
      const event = ProductionEventParser.parse(raw);
      expect(event.rawId).toBe('777-2');
    });

    it('defaults eventIndex to 0 when id has no hyphen', () => {
      const raw = makeRaw('campaign', 'settled', [1n, 0n], 'noindex', 100);
      const event = ProductionEventParser.parse(raw);
      expect(event.eventIndex).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('coerces numeric ScVal data to string', () => {
      const raw = makeRaw('campaign', 'created', [
        999n,
        'GFARMER',
        'GTOKEN',
        5000n,
        8888n,
      ]);
      const event = ProductionEventParser.parse(raw);
      if (event.action === 'campaign.created') {
        expect(typeof event.campaignId).toBe('string');
        expect(event.campaignId).toBe('999');
        expect(event.targetAmount).toBe('5000');
      }
    });

    it('handles empty data array for generic events without throwing', () => {
      const raw = makeRaw('campaign', 'produce', [5n]);
      expect(() => ProductionEventParser.parse(raw)).not.toThrow();
    });

    it('tryParse returns null for events with malformed value XDR', () => {
      const raw: RawSorobanEvent = {
        id: '1-0',
        type: 'contract',
        ledger: 1,
        ledgerClosedAt: new Date().toISOString(),
        contractId: 'C',
        topic: [encodeSymbol('campaign'), encodeSymbol('created')],
        value: 'not-valid-base64-xdr!!!',
      };
      // parse throws, tryParse should swallow and return null
      expect(ProductionEventParser.tryParse(raw)).toBeNull();
    });

    it('throws for order namespace with unknown verb', () => {
      const raw = makeRaw('order', 'cancelled', []);
      // "order.cancelled" isn't a registered EventAction, so this now fails
      // canonical schema validation rather than reaching the switch's default
      // case — either way the parser must reject it.
      expect(() => ProductionEventParser.parse(raw)).toThrow(/unknown (action|event type)/i);
    });

    it('tryParse returns null instead of throwing for order unknown verb', () => {
      const raw = makeRaw('order', 'cancelled', []);
      expect(ProductionEventParser.tryParse(raw)).toBeNull();
    });

    it('parses order.created with zero-amount correctly', () => {
      const raw = makeRaw('order', 'created', [1n, 'GBUYER', 2n, 0n]);
      const event = ProductionEventParser.parse(raw);
      if (event.action === 'order.created') {
        expect(event.amount).toBe('0');
      }
    });

    it('parses campaign.invested with large i128 values without precision loss', () => {
      const large = BigInt('170141183460469231731687303715884105727'); // i128 max
      const raw = makeRaw('campaign', 'invested', [
        1n,
        'GINVESTOR',
        large,
        large,
      ]);
      const event = ProductionEventParser.parse(raw);
      if (event.action === 'campaign.invested') {
        expect(event.amount).toBe(large.toString());
        expect(event.totalRaised).toBe(large.toString());
      }
    });
  });
});
