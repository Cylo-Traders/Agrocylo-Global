-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('FUNDING', 'FUNDED', 'IN_PRODUCTION', 'HARVESTED', 'SETTLED', 'FAILED', 'DISPUTED');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateTable: users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'INVESTOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_walletAddress_key" ON "users"("walletAddress");
CREATE INDEX "users_walletAddress_idx" ON "users"("walletAddress");

-- CreateTable: campaigns
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "onChainId" TEXT NOT NULL,
    "farmerAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "targetAmount" TEXT NOT NULL,
    "totalRaised" TEXT NOT NULL DEFAULT '0',
    "totalRevenue" TEXT NOT NULL DEFAULT '0',
    "trancheReleased" TEXT NOT NULL DEFAULT '0',
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'FUNDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campaigns_onChainId_key" ON "campaigns"("onChainId");
CREATE INDEX "campaigns_farmerAddress_idx" ON "campaigns"("farmerAddress");
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateTable: investments
CREATE TABLE "investments" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "investorAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "investments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "investments_campaignId_investorAddress_ledger_key"
    ON "investments"("campaignId", "investorAddress", "ledger");
CREATE INDEX "investments_campaignId_idx" ON "investments"("campaignId");
CREATE INDEX "investments_investorAddress_idx" ON "investments"("investorAddress");

-- CreateTable: orders
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "onChainId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "buyerAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "orders_onChainId_key" ON "orders"("onChainId");
CREATE INDEX "orders_campaignId_idx" ON "orders"("campaignId");
CREATE INDEX "orders_buyerAddress_idx" ON "orders"("buyerAddress");

-- CreateTable: transactions
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ledger" INTEGER NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "txHash" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transactions_ledger_eventIndex_key" ON "transactions"("ledger", "eventIndex");
CREATE INDEX "transactions_campaignId_idx" ON "transactions"("campaignId");
CREATE INDEX "transactions_eventType_idx" ON "transactions"("eventType");

-- AddForeignKeys
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_farmerAddress_fkey"
    FOREIGN KEY ("farmerAddress") REFERENCES "users"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "investments" ADD CONSTRAINT "investments_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "investments" ADD CONSTRAINT "investments_investorAddress_fkey"
    FOREIGN KEY ("investorAddress") REFERENCES "users"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyerAddress_fkey"
    FOREIGN KEY ("buyerAddress") REFERENCES "users"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
