import http from 'http';
import { initSentry, Sentry } from './config/sentry.js';
import app from './app.js';
import logger from './config/logger.js';
import { config } from './config/index.js';
import { initializeSentry } from './config/observability.js';
import { connectDb } from './config/database.js';
import { startContractWatcher } from './services/contractWatcher.js';
import { startWorkers } from './queues/workers.js';
import {
  scheduleGroupOrderExpiry,
  schedulePriceIndexAggregation,
  scheduleReconciliation,
} from './queues/queues.js';
import { startWeatherPolling } from './services/weatherService.js';
import { wsManager } from './services/wsManager.js';
import { closeWsEventBus, subscribeWsEvents } from './services/wsEventBus.js';

async function bootstrap() {
  // Initialize error tracking and tracing first
  initializeSentry('api');

  try {
    initSentry();
    logger.info('[bootstrap]: Starting Agrocylo Backend');
    logger.info(`[bootstrap]: Environment: ${config.nodeEnv}`);
    logger.info(`[bootstrap]: Port: ${config.port}`);
    logger.info(`[bootstrap]: RPC URL: ${config.rpcUrl}`);
    logger.info(`[bootstrap]: Contract ID: ${config.contractId ? 'configured' : 'not configured'}`);
    logger.info(`[bootstrap]: Supabase URL: ${config.supabaseUrl}`);
    logger.info(`[bootstrap]: Redis URL: ${config.redisUrl}`);
    logger.info(`[bootstrap]: Workers enabled: ${config.runWorkers}`);
    logger.info(`[bootstrap]: Contract watcher enabled: ${config.runContractWatcher}`);

    await connectDb();

    const server = http.createServer(app);

    // Attach WebSocket server — must happen before server.listen
    wsManager.init(server);
    await subscribeWsEvents(wsManager);

    // Start Soroban event listener (blockchain → indexer → WebSocket → frontend)
    // Can be disabled by setting RUN_CONTRACT_WATCHER=false for REST-only development
    if (config.runContractWatcher) {
      await startContractWatcher();
    }

    const runningWorkers = config.runWorkers ? startWorkers() : null;
    if (config.runWorkers) {
      await schedulePriceIndexAggregation().catch((error) =>
        logger.error('Failed to schedule price index aggregation', error)
      );
      await scheduleReconciliation().catch((error) =>
        logger.error('Failed to schedule reconciliation', error)
      );
      await scheduleGroupOrderExpiry().catch((error) =>
        logger.error('Failed to schedule group-order expiry', error)
      );
      startWeatherPolling();
      logger.info('[bootstrap]: Weather advisory polling loop started (interval: 1 h)');
      logger.info('[bootstrap]: Reconciliation job scheduled (interval: 15 min)');
    }

    server.listen(config.port, () => {
      logger.info(`[server]: Server is running at http://localhost:${config.port}`);
      logger.info(
        `[server]: WebSocket accepting connections at ws://localhost:${config.port}${config.wsPath}`
      );
    });

    const shutdown = async (signal: string) => {
      logger.warn(`Shutdown signal received: ${signal}`);
      if (runningWorkers) await runningWorkers.close();
      await closeWsEventBus();
      server.close(() => process.exit(0));
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Critical failure during startup:', error);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  Sentry.captureException(reason);
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception — shutting down', { error: error.message, stack: error.stack });
  Sentry.captureException(error);
  // Sentry's transport delivers over the network asynchronously — exiting
  // immediately after capture can drop the event before it's sent. Give it
  // a bounded window to flush before the process actually dies.
  Sentry.close(2000).finally(() => process.exit(1));
});

bootstrap();
