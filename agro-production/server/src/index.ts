import http from 'http';
import app from './app.js';
import logger from './config/logger.js';
import { config } from './config/index.js';
import { connectDB } from './db/client.js';
import { startSorobanEventListener } from './services/sorobanEventListener.js';
import { startProductionWatcher } from './events/watcher.js';
import { attachWebSocketServer } from './services/wsServer.js';

async function bootstrap() {
  try {
    await connectDB();

    // Multi-contract listener — watches both EscrowContract and ProductionEscrowContract
    await startSorobanEventListener();

    // Single-contract watcher (Prisma-backed, resumes from last persisted ledger)
    if (config.contractId && config.contractId !== 'C...') {
      startProductionWatcher().catch((err) =>
        logger.error('Production watcher failed to start', err),
      );
    } else {
      logger.warn('PRODUCTION_CONTRACT_ID not set — single-contract watcher disabled');
    }

    const server = http.createServer(app);
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

bootstrap();
