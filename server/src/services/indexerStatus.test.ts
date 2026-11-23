import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getLatestLedger } = vi.hoisted(() => ({ getLatestLedger: vi.fn() }));

vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: vi.fn(),
  },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config/index.js', () => ({
  config: {
    runContractWatcher: true,
    contractId: 'C-market',
    governanceContractId: 'C-gov',
    rpcUrl: 'https://rpc.test',
  },
}));
vi.mock('../config/database.js', () => ({
  prisma: {
    contractWatcherCheckpoint: { findUnique: vi.fn() },
  },
}));

import {
  getIndexerStatus,
  INDEXER_STALE_LEDGER_THRESHOLD,
  INDEXER_STALE_SECONDS_THRESHOLD,
} from './indexerStatus.js';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { rpc } from '@stellar/stellar-sdk';

const findUnique = vi.mocked(prisma.contractWatcherCheckpoint.findUnique);
const NOW = new Date('2026-01-01T00:00:00Z');

function checkpoint(lastLedger: number, ageSeconds = 0) {
  return {
    service: 'contract-watcher',
    lastLedger,
    createdAt: NOW,
    updatedAt: new Date(NOW.getTime() - ageSeconds * 1000),
  };
}

describe('getIndexerStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rpc.Server).mockImplementation(function () {
      return { getLatestLedger } as any;
    });
    (config as any).runContractWatcher = true;
    getLatestLedger.mockResolvedValue({ sequence: 1010 });
  });

  it('reports disabled without touching DB or RPC when watcher is off', async () => {
    (config as any).runContractWatcher = false;

    const status = await getIndexerStatus(NOW);

    expect(status.enabled).toBe(false);
    expect(status.status).toBe('disabled');
    expect(findUnique).not.toHaveBeenCalled();
    expect(getLatestLedger).not.toHaveBeenCalled();
  });

  it('reports fresh with ledger lag and progress timestamp', async () => {
    findUnique.mockResolvedValue(checkpoint(1000, 10) as any);

    const status = await getIndexerStatus(NOW);

    expect(status.status).toBe('fresh');
    expect(status.lastProcessedLedger).toBe(1000);
    expect(status.latestLedger).toBe(1010);
    expect(status.ledgerLag).toBe(10);
    expect(status.secondsSinceProgress).toBe(10);
    expect(status.lastProgressAt).toBe(new Date(NOW.getTime() - 10_000).toISOString());
    expect(status.contractIds).toEqual(['C-market', 'C-gov']);
  });

  it('reports stalled when ledger lag exceeds threshold', async () => {
    findUnique.mockResolvedValue(checkpoint(1000) as any);
    getLatestLedger.mockResolvedValue({ sequence: 1000 + INDEXER_STALE_LEDGER_THRESHOLD + 1 });

    const status = await getIndexerStatus(NOW);

    expect(status.status).toBe('stalled');
    expect(status.ledgerLag).toBe(INDEXER_STALE_LEDGER_THRESHOLD + 1);
  });

  it('reports stalled when no progress within the time threshold', async () => {
    findUnique.mockResolvedValue(checkpoint(1010, INDEXER_STALE_SECONDS_THRESHOLD + 1) as any);

    const status = await getIndexerStatus(NOW);

    expect(status.status).toBe('stalled');
    expect(status.ledgerLag).toBe(0);
    expect(status.secondsSinceProgress).toBe(INDEXER_STALE_SECONDS_THRESHOLD + 1);
  });

  it('reports stalled when the watcher has never persisted a checkpoint', async () => {
    findUnique.mockResolvedValue(null);

    const status = await getIndexerStatus(NOW);

    expect(status.status).toBe('stalled');
    expect(status.lastProcessedLedger).toBeNull();
    expect(status.lastProgressAt).toBeNull();
  });

  it('falls back to checkpoint freshness when RPC is unreachable', async () => {
    findUnique.mockResolvedValue(checkpoint(1000, 5) as any);
    getLatestLedger.mockRejectedValue(new Error('rpc down'));

    const status = await getIndexerStatus(NOW);

    expect(status.status).toBe('fresh');
    expect(status.latestLedger).toBeNull();
    expect(status.ledgerLag).toBeNull();
  });

  it('reports stalled on RPC outage combined with stale checkpoint', async () => {
    findUnique.mockResolvedValue(checkpoint(1000, INDEXER_STALE_SECONDS_THRESHOLD + 60) as any);
    getLatestLedger.mockRejectedValue(new Error('rpc down'));

    const status = await getIndexerStatus(NOW);

    expect(status.status).toBe('stalled');
  });
});
