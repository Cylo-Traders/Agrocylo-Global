import app from './app.js';
import logger from './config/logger.js';
import { config } from './config/index.js';
import { connectDb } from './config/database.js';
import { startSorobanEventListener } from './services/sorobanEventListener.js';

async function bootstrap() {
  try {
    await connectDb();
    await startSorobanEventListener();
    app.listen(config.port, () => {
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
