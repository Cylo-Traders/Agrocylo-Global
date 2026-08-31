-- Migration: canonical money, idempotent ingestion, out-of-order, identity unification
-- This migration implements the four fixes:
-- 1) Canonical money representation: add check constraints, normalize existing rows
-- 2) Single canonical pipeline: dedupe escrow_transactions, add unique constraint, note derived projections
-- 3) Out-of-order handling: nullable FKs, needs_backfill flag, dead_letters table
-- 4) Identity unification: Profile 1:1 extension of User, Restrict FKs, standardise walletAddress naming

-- 1. Canonical money: normalize existing amount strings to canonical form
-- Helper: trim, remove leading zeros, handle " 1000", "01000", "1000.0", scientific notation via BigInt string handling is done in app,
-- but SQL normalization handles common cases: trim whitespace, strip leading zeros, remove trailing .0*
-- For full i128 canonicalization, app helper will handle; here we fix obvious drift sources.

-- Orders amounts
UPDATE "orders" SET "amount" = TRIM("amount") WHERE "amount" != TRIM("amount");
UPDATE "orders" SET "amount" = REGEXP_REPLACE("amount", '^0+([1-9])', '\1') WHERE "amount" ~ '^0+[1-9]';
UPDATE "orders" SET "amount" = REGEXP_REPLACE("amount", '\.0+$', '') WHERE "amount" ~ '\.0+$';
UPDATE "orders" SET "amount" = '0' WHERE "amount" = '' OR "amount" IS NULL;
-- Ensure "-0" -> "0"
UPDATE "orders" SET "amount" = '0' WHERE "amount" = '-0';

-- Campaigns
UPDATE "campaigns" SET "goalAmount" = TRIM("goalAmount") WHERE "goalAmount" != TRIM("goalAmount");
UPDATE "campaigns" SET "goalAmount" = REGEXP_REPLACE("goalAmount", '^0+([1-9])', '\1') WHERE "goalAmount" ~ '^0+[1-9]';
UPDATE "campaigns" SET "goalAmount" = REGEXP_REPLACE("goalAmount", '\.0+$', '') WHERE "goalAmount" ~ '\.0+$';
UPDATE "campaigns" SET "goalAmount" = '0' WHERE "goalAmount" = '' OR "goalAmount" IS NULL;
UPDATE "campaigns" SET "goalAmount" = '0' WHERE "goalAmount" = '-0';

-- Investments
UPDATE "investments" SET "amount" = TRIM("amount") WHERE "amount" != TRIM("amount");
UPDATE "investments" SET "amount" = REGEXP_REPLACE("amount", '^0+([1-9])', '\1') WHERE "amount" ~ '^0+[1-9]';
UPDATE "investments" SET "amount" = REGEXP_REPLACE("amount", '\.0+$', '') WHERE "amount" ~ '\.0+$';
UPDATE "investments" SET "amount" = '0' WHERE "amount" = '' OR "amount" IS NULL;
UPDATE "investments" SET "amount" = '0' WHERE "amount" = '-0';

-- Escrow events/escrow transactions amounts (if present)
UPDATE "escrow_events" SET "amount" = TRIM("amount") WHERE "amount" != TRIM("amount");
UPDATE "escrow_events" SET "amount" = REGEXP_REPLACE("amount", '^0+([1-9])', '\1') WHERE "amount" ~ '^0+[1-9]';
UPDATE "escrow_events" SET "amount" = REGEXP_REPLACE("amount", '\.0+$', '') WHERE "amount" ~ '\.0+$';
UPDATE "escrow_events" SET "amount" = '0' WHERE "amount" = '' OR "amount" IS NULL;

-- Add check constraints for canonical amount format (0 or [1-9][0-9]*, optional leading - for i128)
-- Use NOT VALID initially to avoid blocking, then validate (but we just add with validation since data now normalized)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_amount_canonical_check') THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_amount_canonical_check" CHECK ("amount" ~ '^-?(0|[1-9][0-9]*)$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_goalAmount_canonical_check') THEN
    ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_goalAmount_canonical_check" CHECK ("goalAmount" ~ '^-?(0|[1-9][0-9]*)$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'investments_amount_canonical_check') THEN
    ALTER TABLE "investments" ADD CONSTRAINT "investments_amount_canonical_check" CHECK ("amount" ~ '^-?(0|[1-9][0-9]*)$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'escrow_events_amount_canonical_check') THEN
    ALTER TABLE "escrow_events" ADD CONSTRAINT "escrow_events_amount_canonical_check" CHECK ("amount" ~ '^-?(0|[1-9][0-9]*)$');
  END IF;
END $$;

-- 2. Idempotent ingestion: dedupe escrow_transactions and add unique constraint
-- Deduplicate existing escrow_transactions that have same (ledger) — since no eventIndex before, we dedupe by (ledger, orderIdOnChain, action)
-- Keep earliest row per duplicate group
DELETE FROM "escrow_transactions" a USING "escrow_transactions" b
WHERE a."id" > b."id"
  AND a."ledger" = b."ledger"
  AND a."orderIdOnChain" = b."orderIdOnChain"
  AND a."action" = b."action";

-- Add eventIndex column if not exists (default 0 for existing rows; new rows will have proper index)
ALTER TABLE "escrow_transactions" ADD COLUMN IF NOT EXISTS "eventIndex" INTEGER NOT NULL DEFAULT 0;

-- Backfill eventIndex from escrow_events where possible (match by ledger + orderId)
-- If no match, keep 0 (will be unique per ledger+0 after dedupe)
-- We attempt to update eventIndex to be unique within ledger by using row_number
-- Simpler: if duplicates still exist on (ledger, eventIndex) after default 0, re-number
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "ledger" ORDER BY "id") -1 AS rn
  FROM "escrow_transactions"
)
UPDATE "escrow_transactions" t SET "eventIndex" = n.rn
FROM numbered n WHERE t."id" = n."id" AND t."eventIndex" = 0;

-- Add unique constraint on [ledger, eventIndex]
CREATE UNIQUE INDEX IF NOT EXISTS "escrow_transactions_ledger_eventIndex_key" ON "escrow_transactions"("ledger", "eventIndex");

-- 3. Out-of-order handling: orders nullable FKs + needs_backfill
-- Add needs_backfill column
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "needs_backfill" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark rows with amount "0" and empty token/seller as needing backfill? But we keep false for existing real data.
-- For rows with sellerAddress = '' (empty), set to NULL after making nullable
-- First, make buyerAddress/sellerAddress nullable

-- Drop existing FK constraints to allow nullable and Restrict
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_buyerAddress_fkey";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_sellerAddress_fkey";

-- Make columns nullable (if not already)
ALTER TABLE "orders" ALTER COLUMN "buyerAddress" DROP NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "sellerAddress" DROP NOT NULL;

-- Clean empty strings to NULL (prevent FK violation with "" user)
UPDATE "orders" SET "sellerAddress" = NULL WHERE "sellerAddress" = '';
UPDATE "orders" SET "buyerAddress" = NULL WHERE "buyerAddress" = '';
UPDATE "orders" SET "buyerAddress" = NULL WHERE "buyerAddress" = 'N/A';
UPDATE "orders" SET "sellerAddress" = NULL WHERE "sellerAddress" = 'N/A';

-- Also fix users table: remove empty walletAddress users created via "" FK
DELETE FROM "users" WHERE "walletAddress" = '' OR "walletAddress" = 'N/A';

-- Normalize wallet case to lower for users and orders addresses (canonical)
UPDATE "users" SET "walletAddress" = LOWER("walletAddress") WHERE "walletAddress" != LOWER("walletAddress");
UPDATE "orders" SET "buyerAddress" = LOWER("buyerAddress") WHERE "buyerAddress" IS NOT NULL AND "buyerAddress" != LOWER("buyerAddress");
UPDATE "orders" SET "sellerAddress" = LOWER("sellerAddress") WHERE "sellerAddress" IS NOT NULL AND "sellerAddress" != LOWER("sellerAddress");

-- Ensure every address referenced by orders has a user row (backfill identity)
INSERT INTO "users" ("id", "walletAddress", "createdAt", "updatedAt")
SELECT gen_random_uuid(), addr, NOW(), NOW()
FROM (
  SELECT DISTINCT "buyerAddress" AS addr FROM "orders" WHERE "buyerAddress" IS NOT NULL
  UNION
  SELECT DISTINCT "sellerAddress" AS addr FROM "orders" WHERE "sellerAddress" IS NOT NULL
) addrs
WHERE addr IS NOT NULL AND addr != ''
ON CONFLICT ("walletAddress") DO NOTHING;

-- Ensure profiles for those users (for FK compatibility where product/cart still references profiles)
INSERT INTO "profiles" ("wallet_address", "role")
SELECT "walletAddress", 'BUYER' FROM "users"
ON CONFLICT ("wallet_address") DO NOTHING;

-- Re-add FKs with Restrict (not Cascade) to prevent financial record loss
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyerAddress_fkey" FOREIGN KEY ("buyerAddress") REFERENCES "users"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_sellerAddress_fkey" FOREIGN KEY ("sellerAddress") REFERENCES "users"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill needs_backfill for rows that have amount "0" and token "" and were likely placeholders (if they have no product and status delivered/completed/refunded)
-- We don't automatically set true; keep false. The app will handle future placeholders.

-- Dead letters table
CREATE TABLE IF NOT EXISTS "dead_letters" (
    "id" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "event_index" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dead_letters_source_event_id_key" ON "dead_letters"("source_event_id");
CREATE INDEX IF NOT EXISTS "dead_letters_ledger_event_index_idx" ON "dead_letters"("ledger", "event_index");

-- 4. Identity unification: Profile 1:1 extension of User, unify wallet column naming, Restrict financial FKs

-- Normalize profiles/locations wallet_address to lower case (Stellar addresses case-sensitive but DB lookup lower for identity)
UPDATE "profiles" SET "wallet_address" = LOWER("wallet_address") WHERE "wallet_address" != LOWER("wallet_address");
UPDATE "locations" SET "wallet_address" = LOWER("wallet_address") WHERE "wallet_address" != LOWER("wallet_address");

-- Ensure profiles have corresponding users (already done above for order addresses, but need for all profiles)
INSERT INTO "users" ("id", "walletAddress", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "wallet_address", NOW(), NOW() FROM "profiles"
ON CONFLICT ("walletAddress") DO NOTHING;

-- Add FK from profiles.wallet_address to users.walletAddress (1:1 extension)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_wallet_address_fkey') THEN
    ALTER TABLE "profiles" ADD CONSTRAINT "profiles_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "users"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Change Product.farmer_wallet FK from Cascade to Restrict to avoid data loss on profile delete
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_farmer_wallet_fkey";
ALTER TABLE "products" ADD CONSTRAINT "products_farmer_wallet_fkey" FOREIGN KEY ("farmer_wallet") REFERENCES "profiles"("wallet_address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Change Cart.buyer_wallet FK from Cascade to Restrict
ALTER TABLE "carts" DROP CONSTRAINT IF EXISTS "carts_buyer_wallet_fkey";
ALTER TABLE "carts" ADD CONSTRAINT "carts_buyer_wallet_fkey" FOREIGN KEY ("buyer_wallet") REFERENCES "profiles"("wallet_address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Change Review FK from Cascade to Restrict
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_subject_wallet_fkey";
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_wallet_fkey" FOREIGN KEY ("subject_wallet") REFERENCES "profiles"("wallet_address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add comments for documentation
COMMENT ON COLUMN "orders"."amount" IS 'Canonical integer string (i128 stroops) — fixed, no exponent, no leading zeros. See lib/money.ts';
COMMENT ON COLUMN "campaigns"."goalAmount" IS 'Canonical integer string (i128 stroops) — fixed, no exponent, no leading zeros. See lib/money.ts';
COMMENT ON COLUMN "investments"."amount" IS 'Canonical integer string (i128 stroops) — fixed, no exponent, no leading zeros. See lib/money.ts';
COMMENT ON COLUMN "orders"."needs_backfill" IS 'True if row created via out-of-order status event before order.created; backfilled when created arrives';
COMMENT ON TABLE "dead_letters" IS 'Quarantined poisoned events that would otherwise halt checkpoint; watcher advances over them';
COMMENT ON TABLE "transactions" IS 'Canonical event table — single source of truth. EscrowEvent/EscrowTransaction are derived projections';
