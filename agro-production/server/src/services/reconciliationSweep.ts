import { prisma } from '../db/client.js';
import logger from '../config/logger.js';
import { captureAlert } from '../config/sentry.js';
import { reconciliationDrift } from './promMetrics.js';
import { reconcileTransaction } from './transactionReconciler.js';
import type { TransactionStatus } from '../schemas/transaction.js';

/**
 * Scheduled reconciliation-drift sweep (Issue #756, standing up the metric
 * Issue 8 introduced but never gave a scheduled process to feed). Detection
 * only — it computes and reports drift (a transaction whose stored status
 * disagrees with what `reconcileTransaction` derives from the ledger/watcher
 * state) but does not write the corrected status back; auto-correction
 * policy belongs to whatever Issue 8 lands, not to an observability PR.
 */
const NON_TERMINAL_STATUSES: TransactionStatus[] = ['awaiting_signature', 'submitted', 'confirmed'];

/** Bounds per-run cost; a backlog larger than this is itself worth knowing about (see `checked` in the result). */
const SWEEP_BATCH_LIMIT = 200;

export interface ReconciliationSweepResult {
  checked: number;
  drifted: number;
}

export async function runReconciliationSweep(): Promise<ReconciliationSweepResult> {
  const transactions = await prisma.transaction.findMany({
    where: { status: { in: NON_TERMINAL_STATUSES } },
    select: { id: true, txHash: true, status: true },
    take: SWEEP_BATCH_LIMIT,
  });

  let drifted = 0;
  for (const tx of transactions) {
    if (!tx.txHash) continue; // nothing to reconcile against without a hash yet
    try {
      const result = await reconcileTransaction(tx.txHash, tx.status);
      if (result.reconciledStatus !== result.dbStatus) {
        drifted += 1;
      }
    } catch (error) {
      logger.error('[reconciliationSweep] Failed to reconcile transaction', { id: tx.id, error });
    }
  }

  reconciliationDrift.set(drifted);

  if (drifted > 0) {
    captureAlert(
      'reconciliation_drift',
      `${drifted} transaction(s) drifted from their DB status during reconciliation sweep`,
      { checked: transactions.length, drifted },
    );
  }

  return { checked: transactions.length, drifted };
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Starts periodic reconciliation sweeps. Idempotent. */
export function startReconciliationSweep(intervalMs: number): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    runReconciliationSweep().catch((error) => {
      logger.error('[reconciliationSweep] Sweep cycle failed', error);
      captureAlert('scheduled_job_failed', 'Reconciliation sweep cycle failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
}

export function isReconciliationSweepRunning(): boolean {
  return sweepTimer !== null;
}

export function stopReconciliationSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
