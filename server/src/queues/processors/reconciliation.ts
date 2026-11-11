import type { Job } from 'bullmq';
import logger from '../../config/logger.js';
import { runReconciliation } from '../../services/reconciliationService.js';

export async function processReconciliation(_job: Job): Promise<void> {
  try {
    logger.info('[Reconciliation] Job started');
    const report = await runReconciliation();
    logger.info('[Reconciliation] Job completed', {
      ordersChecked: report.ordersChecked,
      campaignsChecked: report.campaignsChecked,
      disputesChecked: report.disputesChecked,
      driftsFound: report.driftsFound,
      errors: report.errors.length,
      durationMs: report.completedAt.getTime() - report.startedAt.getTime(),
    });
  } catch (error) {
    logger.error('[Reconciliation] Job failed', error);
    throw error;
  }
}
