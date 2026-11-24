-- Issue #1250: additive migration for the Transaction fields referenced
-- by `src/routes/transactions.ts` and the generated Prisma client but
-- absent from every committed migration. Without this migration, a
-- fresh database created with `prisma migrate deploy` would fail every
-- transaction insert / update that touches `walletAddress` or
-- `status`, and the Nov 22 `mark_indexed_event_transactions` backfill
-- would have no column to UPDATE.
--
-- All operations are additive: the enum is new, the columns are added
-- with safe defaults, existing rows are backfilled to the documented
-- post-ingest status (`submitted` is the enum default and matches the
-- writer semantics in `src/routes/transactions.ts`), and the indexes
-- match the ones declared on the Prisma model (`@@index([walletAddress])`
-- and `@@index([txHash])`).

-- CreateEnum: TransactionStatus. The order mirrors `schema.prisma` so
-- the generated client type stays byte-identical to the DB label order.
CREATE TYPE "TransactionStatus" AS ENUM (
    'awaiting_signature',
    'submitted',
    'confirmed',
    'indexed',
    'failed'
);

-- AlterTable: add the two missing columns.
-- `status` is NOT NULL with the Prisma-declared default so every
-- existing row (which never had a status) receives the post-ingest
-- state. The Nov 22 backfill runs after this migration and reclassifies
-- rows that look like on-chain event imports to `indexed`.
-- `walletAddress` stays nullable, matching `String?` in the schema.
ALTER TABLE "transactions"
    ADD COLUMN "status" "TransactionStatus" NOT NULL DEFAULT 'submitted',
    ADD COLUMN "walletAddress" TEXT;

-- CreateIndex: the two indexes declared on the Prisma model.
CREATE INDEX "transactions_walletAddress_idx" ON "transactions"("walletAddress");
CREATE INDEX "transactions_txHash_idx" ON "transactions"("txHash");
