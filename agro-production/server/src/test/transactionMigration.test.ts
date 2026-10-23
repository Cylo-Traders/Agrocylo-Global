import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Transaction Migration & Schema Consistency (Issue #1250)', () => {
  const migrationsDir = path.resolve(__dirname, '../../prisma/migrations');
  const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');

  it('contains the new additive migration directory for transaction wallet and status', () => {
    const migrationDirName = '20260829000000_add_transaction_wallet_and_status';
    const migrationSqlPath = path.join(migrationsDir, migrationDirName, 'migration.sql');

    expect(fs.existsSync(migrationSqlPath)).toBe(true);

    const sqlContent = fs.readFileSync(migrationSqlPath, 'utf-8');

    // 1. Checks TransactionStatus enum creation
    expect(sqlContent).toContain('CREATE TYPE "TransactionStatus" AS ENUM');
    expect(sqlContent).toContain("'awaiting_signature'");
    expect(sqlContent).toContain("'submitted'");
    expect(sqlContent).toContain("'confirmed'");
    expect(sqlContent).toContain("'indexed'");
    expect(sqlContent).toContain("'failed'");

    // 2. Checks columns added to transactions table
    expect(sqlContent).toContain('ALTER TABLE "transactions"');
    expect(sqlContent).toContain('ADD COLUMN "walletAddress" TEXT');
    expect(sqlContent).toContain('ADD COLUMN "status" "TransactionStatus" NOT NULL DEFAULT \'submitted\'');

    // 3. Checks indexes created
    expect(sqlContent).toContain('CREATE INDEX "transactions_walletAddress_idx" ON "transactions"("walletAddress")');
    expect(sqlContent).toContain('CREATE INDEX "transactions_txHash_idx" ON "transactions"("txHash")');
  });

  it('matches the enum and model definitions in schema.prisma', () => {
    expect(fs.existsSync(schemaPath)).toBe(true);
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

    // Verify model Transaction has walletAddress and status
    expect(schemaContent).toMatch(/model\s+Transaction\s+\{[\s\S]*?walletAddress\s+String\?/);
    expect(schemaContent).toMatch(/model\s+Transaction\s+\{[\s\S]*?status\s+TransactionStatus\s+@default\(submitted\)/);
    expect(schemaContent).toMatch(/model\s+Transaction\s+\{[\s\S]*?@@index\(\[walletAddress\]\)/);
    expect(schemaContent).toMatch(/model\s+Transaction\s+\{[\s\S]*?@@index\(\[txHash\]\)/);

    // Verify TransactionStatus enum
    expect(schemaContent).toMatch(/enum\s+TransactionStatus\s+\{[\s\S]*?awaiting_signature/);
    expect(schemaContent).toMatch(/enum\s+TransactionStatus\s+\{[\s\S]*?submitted/);
    expect(schemaContent).toMatch(/enum\s+TransactionStatus\s+\{[\s\S]*?confirmed/);
    expect(schemaContent).toMatch(/enum\s+TransactionStatus\s+\{[\s\S]*?indexed/);
    expect(schemaContent).toMatch(/enum\s+TransactionStatus\s+\{[\s\S]*?failed/);
  });

  it('ensures migration directory sequence remains strictly chronological', () => {
    const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
    const migrationDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    // Verify migration list order
    expect(migrationDirs.length).toBeGreaterThanOrEqual(11);
    expect(migrationDirs[0]).toBe('20260425_init');
    expect(migrationDirs[migrationDirs.length - 1]).toBe('20260829000000_add_transaction_wallet_and_status');
  });
});
