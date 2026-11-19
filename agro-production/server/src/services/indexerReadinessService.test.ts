import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEventCursorFindUnique } = vi.hoisted(() => ({
  mockEventCursorFindUnique: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    eventCursor: {
      findUnique: mockEventCursorFindUnique,
    },
  },
}));

vi.mock('../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getIndexerReadiness } from './indexerReadinessService.js';

describe('indexerReadinessService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns not ready and not fresh when no cursor exists for the requested contract', async () => {
    mockEventCursorFindUnique.mockResolvedValue(null);

    const result = await getIndexerReadiness('CONTRACT_A');

    expect(mockEventCursorFindUnique).toHaveBeenCalledWith({
      where: { contractId: 'CONTRACT_A' },
    });
    expect(result).toEqual({
      isReady: false,
      lastProcessedLedger: 0,
      lastProcessedTime: null,
      freshnessSeconds: -1,
      isFresh: false,
      maxLagSeconds: 300,
      cursor: null,
    });
  });

  it('derives freshness from cursor.updatedAt when indexer is recent and fresh', async () => {
    const now = new Date();
    const tenSecondsAgo = new Date(now.getTime() - 10 * 1000);

    mockEventCursorFindUnique.mockResolvedValue({
      id: 'cursor-1',
      contractId: 'CONTRACT_A',
      ledger: 1050,
      eventIndex: 2,
      ledgerHash: 'hash-abc',
      updatedAt: tenSecondsAgo,
      createdAt: new Date(now.getTime() - 1000 * 1000),
    });

    const result = await getIndexerReadiness('CONTRACT_A', 300);

    expect(result.isReady).toBe(true);
    expect(result.lastProcessedLedger).toBe(1050);
    expect(result.lastProcessedTime).toEqual(tenSecondsAgo);
    expect(result.freshnessSeconds).toBeGreaterThanOrEqual(10);
    expect(result.freshnessSeconds).toBeLessThan(15);
    expect(result.isFresh).toBe(true);
    expect(result.cursor).toEqual({ ledger: 1050, eventIndex: 2 });
  });

  it('reports isFresh: false when cursor.updatedAt exceeds maxLagSeconds', async () => {
    const now = new Date();
    const sixMinutesAgo = new Date(now.getTime() - 360 * 1000);

    mockEventCursorFindUnique.mockResolvedValue({
      id: 'cursor-1',
      contractId: 'CONTRACT_A',
      ledger: 500,
      eventIndex: 0,
      ledgerHash: 'hash-xyz',
      updatedAt: sixMinutesAgo,
      createdAt: new Date(now.getTime() - 1000 * 1000),
    });

    const result = await getIndexerReadiness('CONTRACT_A', 300);

    expect(result.isReady).toBe(true);
    expect(result.isFresh).toBe(false);
    expect(result.freshnessSeconds).toBeGreaterThanOrEqual(360);
  });

  it('regression: scopes readiness strictly to requested contract and isolates separate contracts', async () => {
    const now = new Date();
    const stalledTime = new Date(now.getTime() - 800 * 1000); // 800s ago (stalled)
    const activeTime = new Date(now.getTime() - 5 * 1000);    // 5s ago (fresh)

    mockEventCursorFindUnique.mockImplementation(async ({ where }: { where: { contractId: string } }) => {
      if (where.contractId === 'CONTRACT_STALLED') {
        return {
          id: 'c-stalled',
          contractId: 'CONTRACT_STALLED',
          ledger: 100,
          eventIndex: 0,
          updatedAt: stalledTime,
        };
      }
      if (where.contractId === 'CONTRACT_ACTIVE') {
        return {
          id: 'c-active',
          contractId: 'CONTRACT_ACTIVE',
          ledger: 9999,
          eventIndex: 5,
          updatedAt: activeTime,
        };
      }
      return null;
    });

    // Check stalled contract
    const stalledResult = await getIndexerReadiness('CONTRACT_STALLED', 300);
    expect(stalledResult.isFresh).toBe(false);
    expect(stalledResult.lastProcessedLedger).toBe(100);
    expect(stalledResult.freshnessSeconds).toBeGreaterThanOrEqual(800);

    // Check active contract
    const activeResult = await getIndexerReadiness('CONTRACT_ACTIVE', 300);
    expect(activeResult.isFresh).toBe(true);
    expect(activeResult.lastProcessedLedger).toBe(9999);
    expect(activeResult.freshnessSeconds).toBeLessThan(10);

    // Even though CONTRACT_ACTIVE has very recent activity, CONTRACT_STALLED is NOT made fresh
    const recheckedStalled = await getIndexerReadiness('CONTRACT_STALLED', 300);
    expect(recheckedStalled.isFresh).toBe(false);
    expect(recheckedStalled.freshnessSeconds).toBeGreaterThanOrEqual(800);
  });

  it('handles database exceptions gracefully and returns error fallback', async () => {
    mockEventCursorFindUnique.mockRejectedValue(new Error('Connection lost'));

    const result = await getIndexerReadiness('CONTRACT_A');

    expect(result).toEqual({
      isReady: false,
      lastProcessedLedger: 0,
      lastProcessedTime: null,
      freshnessSeconds: -1,
      isFresh: false,
      maxLagSeconds: 300,
      cursor: null,
    });
  });
});
