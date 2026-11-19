import { describe, it, expect } from 'vitest';
import { BasketEventParser } from './basketEventParser.js';

describe('BasketEventParser', () => {
  it('parses basket.funded event with invested/skipped summary', () => {
    const topics = ['basket', 'funded'];
    const value = [
      1, // schema_version
      '123', // basket_id
      '1000000', // total_deposit
      '600000', // total_invested
      '400000', // total_skipped
    ];
    const meta = {
      id: '123-0',
      ledger: 1000,
      txHash: 'abc123',
      ledgerClosedAt: '2024-01-01T00:00:00Z',
    };

    const result = BasketEventParser.parseDecoded(topics, value, meta);

    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('basket.funded');
    expect(result?.entity).toBe('basket');
    expect(result?.action).toBe('funded');
    expect(result?.schemaVersion).toBe('1');
    expect(result?.basketIdOnChain).toBe('123');
    expect(result?.amount).toBe('1000000');
    expect(result?.totalInvested).toBe('600000');
    expect(result?.totalSkipped).toBe('400000');
  });

  it('parses basket.skipped event with failure reason', () => {
    const topics = ['basket', 'skipped'];
    const value = [
      1, // schema_version
      '123', // basket_id
      '456', // campaign_id
      '400000', // share (skipped amount)
    ];
    const meta = {
      id: '123-1',
      ledger: 1000,
      txHash: 'abc123',
      ledgerClosedAt: '2024-01-01T00:00:00Z',
    };

    const result = BasketEventParser.parseDecoded(topics, value, meta);

    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('basket.skipped');
    expect(result?.entity).toBe('basket');
    expect(result?.action).toBe('skipped');
    expect(result?.schemaVersion).toBe('1');
    expect(result?.basketIdOnChain).toBe('123');
    expect(result?.campaignIdOnChain).toBe('456');
    expect(result?.amount).toBe('400000');
  });

  it('ignores unsupported event types', () => {
    const topics = ['basket', 'unknown'];
    const value = ['123'];
    const meta = { id: '123-0', ledger: 1000 };

    const result = BasketEventParser.parseDecoded(topics, value, meta);

    expect(result).toBeNull();
  });

  it('ignores events with missing topics', () => {
    const topics = ['basket'];
    const value = ['123'];
    const meta = { id: '123-0', ledger: 1000 };

    const result = BasketEventParser.parseDecoded(topics, value, meta);

    expect(result).toBeNull();
  });
});
