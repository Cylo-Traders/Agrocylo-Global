import logger from './config/logger.js';
import { initializeSentry } from './config/observability.js';
import { startWorkers } from './queues/workers.js';
import { scheduleGroupOrderExpiry } from './queues/queues.js';
import { closeWsEventBus } from './services/wsEventBus.js';

// Initialize error tracking and tracing
initializeSentry('worker');

const running = startWorkers();
void scheduleGroupOrderExpiry().catch((error) => {
  logger.error('Failed to schedule group-order expiry', error);
});

function shutdown(signal: string) {
  logger.warn(`Worker shutdown signal received: ${signal}`);
  running
    .close()
    .then(() => closeWsEventBus())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Worker shutdown failure', err);
      process.exit(1);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
