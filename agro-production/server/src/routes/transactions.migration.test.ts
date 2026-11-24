/**
 * Issue #1250: a smoke check that the required DDL for the Transaction
 * model is present in a committed migration. A fresh database created
 * with `prisma migrate deploy` has to match `schema.prisma`, so if a
 * future refactor drops any of this DDL the test fails loudly rather
 * than at runtime inside a transaction insert.
 *
 * The check reads the migration files rather than talking to a real
 * database so it runs in the unit suite (no PG, no network) and so a
 * drift between the model and the SQL is caught before CI stands up a
 * container.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');

function readAllMigrationSql(): string {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return dirs
    .map((d) => {
      try {
        return readFileSync(join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n\n');
}

describe('Transaction migration coverage (#1250)', () => {
  const sql = readAllMigrationSql();

  it('creates the TransactionStatus enum with every value declared in schema.prisma', () => {
    // The order matches the schema so the generated client's label
    // order stays stable; the test asserts on membership, not order.
    for (const label of [
      'awaiting_signature',
      'submitted',
      'confirmed',
      'indexed',
      'failed',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TYPE "TransactionStatus".*'${label}'`, 's'));
    }
  });

  it('adds the status column to the transactions table', () => {
    expect(sql).toMatch(/ADD COLUMN "status" "TransactionStatus"/);
  });

  it('adds the walletAddress column to the transactions table', () => {
    expect(sql).toMatch(/ADD COLUMN "walletAddress" TEXT/);
  });

  it('creates the walletAddress and txHash indexes the Prisma model declares', () => {
    expect(sql).toMatch(
      /CREATE INDEX "transactions_walletAddress_idx" ON "transactions"\("walletAddress"\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX "transactions_txHash_idx" ON "transactions"\("txHash"\)/,
    );
  });

  it('runs the enum creation before the backfill in `20261122_mark_indexed_event_transactions`', () => {
    // The backfill SET status = 'indexed' assumes the column exists.
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const enumMigrationIdx = dirs.findIndex((d) =>
      d.endsWith('add_transaction_wallet_and_status'),
    );
    const backfillMigrationIdx = dirs.findIndex((d) =>
      d.endsWith('mark_indexed_event_transactions'),
    );
    expect(enumMigrationIdx).toBeGreaterThanOrEqual(0);
    expect(backfillMigrationIdx).toBeGreaterThanOrEqual(0);
    expect(enumMigrationIdx).toBeLessThan(backfillMigrationIdx);
  });
});
