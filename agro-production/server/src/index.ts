import http from 'http';
import { initSentry, Sentry } from './config/sentry.js';
import app from './app.js';
import logger from './config/logger.js';
import { config } from './config/index.js';
import { connectDB } from './db/client.js';
import { startProductionWatcher } from './events/watcher.js';
import { runProductionReconciliation } from './services/reconciliationService.js';
import { attachWebSocketServer } from './services/wsServer.js';
import { registerHttpServer, registerWatcher, shutdown } from './services/lifecycle.js';
import { startReconciliationSweep, stopReconciliationSweep } from './services/reconciliationSweep.js';

async function bootstrap() {
  try {
    initSentry();
    await connectDB();

    let watcherInterval: ReturnType<typeof setInterval> | null = null;
    watcherInterval = await startProductionWatcher();
    if (watcherInterval) {
      registerWatcher(watcherInterval);
    }

    // Start reconciliation scheduler (every 15 minutes)
    const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
    const reconciliationInterval = setInterval(() => {
      runProductionReconciliation().catch((err) => {
        logger.error('[Reconciliation] Scheduled run failed', { error: err instanceof Error ? err.message : String(err) });
      });
    }, RECONCILIATION_INTERVAL_MS);
    registerWatcher(reconciliationInterval);
    logger.info('[Reconciliation] Scheduled to run every 15 minutes');

    // Ledger drift sweep feeding reconciliation_drift_count (Issue #1205).
    if (config.runReconciliationSweep) {
      startReconciliationSweep(config.reconciliationSweepIntervalMs);
      logger.info(
        `[reconciliationSweep] Scheduled to run every ${config.reconciliationSweepIntervalMs}ms`,
      );
    }

    const server = http.createServer(app);
    registerHttpServer(server);
    attachWebSocketServer(server);

    server.listen(config.port, () => {
      logger.info(
        `[server]: Production backend running at http://localhost:${config.port}`,
      );
    });
  } catch (error) {
    logger.error('Critical failure during startup:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  stopReconciliationSweep();
  shutdown('SIGTERM').then(() => process.exit(0));
});

process.on('SIGINT', () => {
  stopReconciliationSweep();
  shutdown('SIGINT').then(() => process.exit(0));
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', { reason: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined });
  Sentry.captureException(reason);
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception — shutting down', { error: error.message, stack: error.stack });
  Sentry.captureException(error);
  Sentry.close(2000).finally(() => process.exit(1));
});

bootstrap();
