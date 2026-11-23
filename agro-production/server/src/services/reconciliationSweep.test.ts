import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { findMany, findOrders } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findOrders: vi.fn(),
}));
vi.mock('../db/client.js', () => ({
  prisma: {
    transaction: { findMany },
    order: { findMany: findOrders },
  },
}));

const { captureAlert, loggerWarn } = vi.hoisted(() => ({
  captureAlert: vi.fn(),
  loggerWarn: vi.fn(),
}));
vi.mock('../config/sentry.js', () => ({ captureAlert }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: loggerWarn, error: vi.fn(), debug: vi.fn() },
}));

const { reconcileTransaction } = vi.hoisted(() => ({
  reconcileTransaction: vi.fn(),
}));
vi.mock('./transactionReconciler.js', () => ({ reconcileTransaction }));

const { gaugeSet } = vi.hoisted(() => ({ gaugeSet: vi.fn() }));
vi.mock('./promMetrics.js', () => ({
  reconciliationDrift: { set: gaugeSet },
}));

import { runReconciliationSweep } from './reconciliationSweep.js';

describe('reconciliationSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOrders.mockResolvedValue([]);
  });

  it('reports zero drift and does not alert when everything reconciles cleanly', async () => {
    findMany.mockResolvedValue([
      { id: 'tx1', txHash: 'hash1', status: 'confirmed' },
      { id: 'tx2', txHash: 'hash2', status: 'submitted' },
    ]);
    reconcileTransaction.mockImplementation(
      async (_hash: string, status: string) => ({
        dbStatus: status,
        reconciledStatus: status,
        confirmedInLedger: true,
        indexedByWatcher: false,
        latestIndexedLedger: 100,
      }),
    );

    const result = await runReconciliationSweep();

    expect(result).toEqual({ checked: 2, drifted: 0, expiredIntents: 0 });
    expect(gaugeSet).toHaveBeenCalledWith(0);
    expect(captureAlert).not.toHaveBeenCalled();
  });

  it('counts drift and alerts when a transaction disagrees with its reconciled status', async () => {
    findMany.mockResolvedValue([
      { id: 'tx1', txHash: 'hash1', status: 'submitted' },
      { id: 'tx2', txHash: 'hash2', status: 'confirmed' },
    ]);
    reconcileTransaction.mockImplementation(
      async (_hash: string, status: string) => {
        if (status === 'submitted') {
          // Watcher already indexed this one — DB is stale.
          return {
            dbStatus: 'submitted',
            reconciledStatus: 'indexed',
            confirmedInLedger: true,
            indexedByWatcher: true,
            latestIndexedLedger: 100,
          };
        }
        return {
          dbStatus: status,
          reconciledStatus: status,
          confirmedInLedger: true,
          indexedByWatcher: false,
          latestIndexedLedger: 100,
        };
      },
    );

    const result = await runReconciliationSweep();

    expect(result).toEqual({ checked: 2, drifted: 1, expiredIntents: 0 });
    expect(gaugeSet).toHaveBeenCalledWith(1);
    expect(captureAlert).toHaveBeenCalledWith(
      'reconciliation_drift',
      expect.stringContaining('1 transaction(s) drifted'),
      expect.objectContaining({ checked: 2, drifted: 1 }),
    );
  });

  it('skips transactions with no txHash yet rather than failing the sweep', async () => {
    findMany.mockResolvedValue([
      { id: 'tx1', txHash: null, status: 'awaiting_signature' },
    ]);

    const result = await runReconciliationSweep();

    expect(reconcileTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, drifted: 0, expiredIntents: 0 });
  });

  it('reports expired unresolved intents without changing their state', async () => {
    const expiredIntent = {
      id: 'order-placeholder',
      onChainId: 'intent:expired',
      createdAt: new Date('2025-01-01T00:00:00Z'),
    };
    findMany.mockResolvedValue([]);
    findOrders.mockResolvedValue([expiredIntent]);

    const result = await runReconciliationSweep();

    expect(result.expiredIntents).toBe(1);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('manual review required'),
      expect.objectContaining({ count: 1 }),
    );
    expect(findOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          onChainId: { startsWith: 'intent:' },
          status: 'PENDING',
        }),
      }),
    );
  });
});

describe('reconciliationSweep scheduler', () => {
  it('registers a timer on start and clears it on stop', async () => {
    const {
      startReconciliationSweep,
      stopReconciliationSweep,
      isReconciliationSweepRunning,
    } = await import('./reconciliationSweep.js');
    expect(isReconciliationSweepRunning()).toBe(false);
    startReconciliationSweep(60_000);
    expect(isReconciliationSweepRunning()).toBe(true);
    stopReconciliationSweep();
    expect(isReconciliationSweepRunning()).toBe(false);
  });
});
