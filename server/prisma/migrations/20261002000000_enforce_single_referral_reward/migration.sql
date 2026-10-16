-- Preserve duplicate credit rows for audit. Revoke only duplicate credits
-- that are still outstanding, then detach legacy duplicates before enforcing
-- the one-credit-per-referral invariant.
ALTER TABLE "fee_credits"
ADD COLUMN "revoked_at" TIMESTAMP(3);

WITH ranked AS (
  SELECT
    "id",
    "consumed_at",
    ROW_NUMBER() OVER (
      PARTITION BY "source_referral_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS reward_rank
  FROM "fee_credits"
  WHERE "source_referral_id" IS NOT NULL
)
UPDATE "fee_credits" AS credit
SET "revoked_at" = COALESCE(credit."revoked_at", NOW())
FROM ranked
WHERE credit."id" = ranked."id"
  AND ranked.reward_rank > 1
  AND ranked."consumed_at" IS NULL;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "source_referral_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS reward_rank
  FROM "fee_credits"
  WHERE "source_referral_id" IS NOT NULL
)
UPDATE "fee_credits" AS credit
SET "source_referral_id" = NULL
FROM ranked
WHERE credit."id" = ranked."id"
  AND ranked.reward_rank > 1;

CREATE UNIQUE INDEX "fee_credits_source_referral_id_key"
ON "fee_credits"("source_referral_id");
