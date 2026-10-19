import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../db/client.js', () => ({
  prisma: { transaction: { findMany } },
}));

const { captureAlert } = vi.hoisted(() => ({ captureAlert: vi.fn() }));
vi.mock('../config/sentry.js', () => ({ captureAlert }));

const { reconcileTransaction } = vi.hoisted(() => ({ reconcileTransaction: vi.fn() }));
vi.mock('./transactionReconciler.js', () => ({ reconcileTransaction }));

const { gaugeSet } = vi.hoisted(() => ({ gaugeSet: vi.fn() }));
vi.mock('./promMetrics.js', () => ({
  reconciliationDrift: { set: gaugeSet },
}));

import {
  runReconciliationSweep,
  startReconciliationSweep,
  stopReconciliationSweep,
} from './reconciliationSweep.js';

describe('reconciliationSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports zero drift and does not alert when everything reconciles cleanly', async () => {
    findMany.mockResolvedValue([
      { id: 'tx1', txHash: 'hash1', status: 'confirmed' },
      { id: 'tx2', txHash: 'hash2', status: 'submitted' },
    ]);
    reconcileTransaction.mockImplementation(async (_hash: string, status: string) => ({
      dbStatus: status,
      reconciledStatus: status,
      confirmedInLedger: true,
      indexedByWatcher: false,
      latestIndexedLedger: 100,
    }));

    const result = await runReconciliationSweep();

    expect(result).toEqual({ checked: 2, drifted: 0 });
    expect(gaugeSet).toHaveBeenCalledWith(0);
    expect(captureAlert).not.toHaveBeenCalled();
  });

  it('counts drift and alerts when a transaction disagrees with its reconciled status', async () => {
    findMany.mockResolvedValue([
      { id: 'tx1', txHash: 'hash1', status: 'submitted' },
      { id: 'tx2', txHash: 'hash2', status: 'confirmed' },
    ]);
    reconcileTransaction.mockImplementation(async (_hash: string, status: string) => {
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
    });

    const result = await runReconciliationSweep();

    expect(result).toEqual({ checked: 2, drifted: 1 });
    expect(gaugeSet).toHaveBeenCalledWith(1);
    expect(captureAlert).toHaveBeenCalledWith(
      'reconciliation_drift',
      expect.stringContaining('1 transaction(s) drifted'),
      expect.objectContaining({ checked: 2, drifted: 1 }),
    );
  });

  it('skips transactions with no txHash yet rather than failing the sweep', async () => {
    findMany.mockResolvedValue([{ id: 'tx1', txHash: null, status: 'awaiting_signature' }]);

    const result = await runReconciliationSweep();

    expect(reconcileTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, drifted: 0 });
  });

  describe('scheduling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      findMany.mockResolvedValue([]);
    });

    afterEach(() => {
      stopReconciliationSweep();
      vi.useRealTimers();
    });

    it('runs the sweep on each interval tick once started', async () => {
      startReconciliationSweep(1000);

      await vi.advanceTimersByTimeAsync(2500);

      expect(findMany).toHaveBeenCalledTimes(2);
      expect(gaugeSet).toHaveBeenCalledWith(0);
    });

    it('stops running after stopReconciliationSweep', async () => {
      startReconciliationSweep(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(findMany).toHaveBeenCalledTimes(1);

      stopReconciliationSweep();
      await vi.advanceTimersByTimeAsync(5000);

      expect(findMany).toHaveBeenCalledTimes(1);
    });
  });
});
