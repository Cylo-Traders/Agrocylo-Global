import http from "http";
import app from "./app.js";
import logger from "./config/logger.js";
import { config } from "./config/index.js";
import { connectDb } from "./config/database.js";
import { startContractWatcher } from "./services/contractWatcher.js";
import { SocketService } from "./services/socketService.js";

async function bootstrap() {
  try {
    await connectDb();
    startContractWatcher();
    const server = http.createServer(app);
    SocketService.initialize(server);
    server.listen(config.port, () => {
      logger.info(
        `[server]: Server is running at http://localhost:${config.port}`,
      );
    });
    wsManager.init(server);
  } catch (error) {
    logger.error("Critical failure during startup:", error);
    process.exit(1);
  }
}

bootstrap();
