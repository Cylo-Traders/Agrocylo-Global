import app from './app.js';
import logger from './config/logger.js';
import { config } from './config/index.js';

app.listen(config.port, () => {
  logger.info(`[server]: Server is running at http://localhost:${config.port}`);
});