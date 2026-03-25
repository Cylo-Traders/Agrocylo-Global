import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { PrismaClient } from '@prisma/client';
import logger from './logger.js';

export const prisma = new PrismaClient();

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
});

export async function connectDb() {
  try {
    await pool.query('select 1');
    logger.info('Database connection successful.');
  } catch (error) {
    logger.error('Database connection failed:', error);
    process.exit(1);
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await handler(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export default pool;