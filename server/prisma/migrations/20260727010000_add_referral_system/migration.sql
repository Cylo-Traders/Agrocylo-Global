-- CreateTable
CREATE TABLE "referral_codes" (
    "wallet_address" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("wallet_address")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrer_wallet" TEXT NOT NULL,
    "referee_wallet" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rewarded_at" TIMESTAMP(3),
    "reward_amount" TEXT,
    "trigger_order_id" TEXT,
    "trigger_campaign_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referee_wallet_key" ON "referrals"("referee_wallet");

-- CreateIndex
CREATE INDEX "referrals_referrer_wallet_idx" ON "referrals"("referrer_wallet");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "referrals"("status");

-- CreateTable
CREATE TABLE "fee_credits" (
    "id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source_referral_id" TEXT,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_credits_wallet_address_idx" ON "fee_credits"("wallet_address");

-- CreateIndex
CREATE INDEX "fee_credits_wallet_address_consumed_at_idx" ON "fee_credits"("wallet_address", "consumed_at");
