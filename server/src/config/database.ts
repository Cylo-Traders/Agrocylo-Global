import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import logger from './logger.js';

const adapter = new PrismaPg({
  connectionString: process.env['DATABASE_URL'],
});

const prisma = new PrismaClient({
  adapter,
  log: ['query', 'info', 'warn', 'error'],
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

export default prisma;