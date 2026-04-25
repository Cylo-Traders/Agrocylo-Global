import { config } from "./config/index.js";
import logger from "./config/logger.js";
import { connectDB } from "./db/client.js";
import app from "./app.js";
import { startProductionWatcher } from "./events/watcher.js";

async function main() {
  await connectDB();

  if (config.contractId && config.contractId !== "C...") {
    startProductionWatcher().catch((err) =>
      logger.error("Production watcher failed to start", err),
    );
  } else {
    logger.warn("PRODUCTION_CONTRACT_ID not set — watcher disabled");
  }

  app.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
