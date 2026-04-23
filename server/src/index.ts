import app from "./app.js";
import logger from "./config/logger.js";
import { config } from "./config/index.js";
import { connectDb } from "./config/database.js";
import { startContractWatcher } from "./services/contractWatcher.js";
import { startWorkers } from "./queues/workers.js";

async function bootstrap() {
  try {
    await connectDb();
    startContractWatcher();

    const runningWorkers = config.runWorkers ? startWorkers() : null;

    app.listen(config.port, () => {
      logger.info(
        `[server]: Server is running at http://localhost:${config.port}`
      );
    });

    const shutdown = async (signal: string) => {
      logger.warn(`Shutdown signal received: ${signal}`);
      if (runningWorkers) await runningWorkers.close();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (error) {
    logger.error("Critical failure during startup:", error);
    process.exit(1);
  }
}

bootstrap();
