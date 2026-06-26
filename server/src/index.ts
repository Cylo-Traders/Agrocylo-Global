import http from "http";
import app from "./app.js";
import logger from "./config/logger.js";
import { config } from "./config/index.js";
import { connectDb } from "./config/database.js";
import { startContractWatcher } from "./services/contractWatcher.js";
import { startWorkers } from "./queues/workers.js";
import { wsManager } from "./services/wsManager.js";

async function bootstrap() {
  try {
    logger.info("[bootstrap]: Starting Agrocylo Backend");
    logger.info(`[bootstrap]: Environment: ${config.nodeEnv}`);
    logger.info(`[bootstrap]: Port: ${config.port}`);
    logger.info(`[bootstrap]: RPC URL: ${config.rpcUrl}`);
    logger.info(
      `[bootstrap]: Contract ID: ${config.contractId ? "configured" : "not configured"}`,
    );
    logger.info(`[bootstrap]: Supabase URL: ${config.supabaseUrl}`);
    logger.info(`[bootstrap]: Redis URL: ${config.redisUrl}`);
    logger.info(`[bootstrap]: Workers enabled: ${config.runWorkers}`);
    logger.info(
      `[bootstrap]: Contract watcher enabled: ${config.runContractWatcher}`,
    );

    await connectDb();

    const server = http.createServer(app);

    // Attach WebSocket server — must happen before server.listen
    wsManager.init(server);

    // Start Soroban event listener (blockchain → indexer → WebSocket → frontend)
    // Can be disabled by setting RUN_CONTRACT_WATCHER=false for REST-only development
    if (config.runContractWatcher) {
      await startContractWatcher();
    }

    const runningWorkers = config.runWorkers ? startWorkers() : null;

    server.listen(config.port, () => {
      logger.info(
        `[server]: Server is running at http://localhost:${config.port}`,
      );
      logger.info(
        `[server]: WebSocket accepting connections at ws://localhost:${config.port}${config.wsPath}`,
      );
    });

    const shutdown = async (signal: string) => {
      logger.warn(`Shutdown signal received: ${signal}`);
      if (runningWorkers) await runningWorkers.close();
      server.close(() => process.exit(0));
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (error) {
    logger.error("Critical failure during startup:", error);
    process.exit(1);
  }
}

bootstrap();
