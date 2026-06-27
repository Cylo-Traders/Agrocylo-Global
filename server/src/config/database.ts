import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import logger from './logger.js';

const connectionString = process.env['DATABASE_URL']!;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const isDevelopment = (process.env['NODE_ENV'] ?? 'development') === 'development';

export const prisma = new PrismaClient({
  adapter,
  log: isDevelopment ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
});

export async function connectDb() {
  try {
    await prisma.$connect();
    logger.info('Database connection successful.');
  } catch (error) {
    logger.error('Database connection failed:', error);
    process.exit(1);
  }
}
