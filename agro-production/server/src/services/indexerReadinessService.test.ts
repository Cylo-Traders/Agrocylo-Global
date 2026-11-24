import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type CursorRow = {
  id: string;
  contractId: string;
  ledger: number;
  eventIndex: number;
  ledgerHash: string | null;
  lastProcessedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

type TxRow = { ledger: number; eventIndex: number; processedAt: Date };

const cursors = new Map<string, CursorRow>();
const transactions: TxRow[] = [];

vi.mock('../db/client.js', () => ({
  prisma: {
    eventCursor: {
      findUnique: vi.fn(
        async ({ where }: { where: { contractId: string } }) =>
          cursors.get(where.contractId) ?? null,
      ),
    },
    transaction: {
      // Shared, contract-agnostic table — readiness must not read it.
      findFirst: vi.fn(
        async () =>
          [...transactions].sort(
            (a, b) => b.processedAt.getTime() - a.processedAt.getTime(),
          )[0] ?? null,
      ),
    },
  },
}));

import { prisma } from '../db/client.js';
import { getIndexerReadiness } from './indexerReadinessService.js';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const CONTRACT_A = 'CA_STALLED_CONTRACT';
const CONTRACT_B = 'CB_ACTIVE_CONTRACT';

function cursor(
  contractId: string,
  ledger: number,
  lastProcessedAt: Date | null,
  updatedAt: Date = lastProcessedAt ?? NOW,
): CursorRow {
  return {
    id: `cursor-${contractId}`,
    contractId,
    ledger,
    eventIndex: 0,
    ledgerHash: null,
    lastProcessedAt,
    updatedAt,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('getIndexerReadiness — contract-scoped freshness (Issue #1344)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    cursors.clear();
    transactions.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("another contract's events cannot make a stalled indexer look fresh", async () => {
    // Contract A stalled an hour ago at ledger 1000.
    cursors.set(
      CONTRACT_A,
      cursor(CONTRACT_A, 1000, new Date(NOW.getTime() - 3600_000)),
    );
    // Contract B is active at a nearby ledger and just wrote events into the
    // shared transactions table within ten ledgers of A's cursor.
    cursors.set(
      CONTRACT_B,
      cursor(CONTRACT_B, 1005, new Date(NOW.getTime() - 5_000)),
    );
    transactions.push(
      {
        ledger: 1004,
        eventIndex: 1,
        processedAt: new Date(NOW.getTime() - 5_000),
      },
      {
        ledger: 1005,
        eventIndex: 0,
        processedAt: new Date(NOW.getTime() - 2_000),
      },
    );

    const a = await getIndexerReadiness(CONTRACT_A, 300);
    const b = await getIndexerReadiness(CONTRACT_B, 300);

    expect(a.isFresh).toBe(false);
    expect(a.freshnessSeconds).toBe(3600);
    expect(a.lastProcessedTime?.toISOString()).toBe(
      new Date(NOW.getTime() - 3600_000).toISOString(),
    );
    expect(a.lastProcessedLedger).toBe(1000);

    expect(b.isFresh).toBe(true);
    expect(b.freshnessSeconds).toBe(5);
    expect(b.lastProcessedLedger).toBe(1005);

    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
  });

  it('result for a contract is unchanged when other contracts add events', async () => {
    cursors.set(
      CONTRACT_A,
      cursor(CONTRACT_A, 500, new Date(NOW.getTime() - 120_000)),
    );
    const before = await getIndexerReadiness(CONTRACT_A, 300);

    cursors.set(CONTRACT_B, cursor(CONTRACT_B, 501, NOW));
    transactions.push({ ledger: 501, eventIndex: 0, processedAt: NOW });
    const after = await getIndexerReadiness(CONTRACT_A, 300);

    expect(after).toEqual(before);
    expect(after.isFresh).toBe(true);
    expect(after.freshnessSeconds).toBe(120);
  });

  it('falls back to the cursor updatedAt when lastProcessedAt is not set', async () => {
    cursors.set(
      CONTRACT_A,
      cursor(CONTRACT_A, 42, null, new Date(NOW.getTime() - 600_000)),
    );
    const r = await getIndexerReadiness(CONTRACT_A, 300);
    expect(r.isFresh).toBe(false);
    expect(r.freshnessSeconds).toBe(600);
  });

  it('reports not ready when the contract has no cursor, even if others do', async () => {
    cursors.set(CONTRACT_B, cursor(CONTRACT_B, 10, NOW));
    transactions.push({ ledger: 10, eventIndex: 0, processedAt: NOW });

    const r = await getIndexerReadiness(CONTRACT_A, 300);
    expect(r).toMatchObject({
      isReady: false,
      isFresh: false,
      lastProcessedTime: null,
      cursor: null,
    });
  });
});
