import 'dotenv/config';
import logger from './logger.js';

const requiredEnvs = ['PORT', 'NODE_ENV'];
requiredEnvs.forEach((key) => {
  if (!process.env[key]) {
    logger.warn(`Environment variable ${key} is missing. Using default.`);
  }
});

export const config = {
  port: process.env['PORT'] ?? 5000,
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
};