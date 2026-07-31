-- CreateEnum
CREATE TYPE "BasketStatus" AS ENUM ('OPEN', 'FUNDED');

-- CreateTable
CREATE TABLE "baskets" (
    "id" TEXT NOT NULL,
    "onChainId" TEXT NOT NULL,
    "constituentsCount" INTEGER NOT NULL,
    "totalDeposited" TEXT NOT NULL DEFAULT '0',
    "status" "BasketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "baskets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "baskets_onChainId_key" ON "baskets"("onChainId");
CREATE INDEX "baskets_status_idx" ON "baskets"("status");

-- CreateTable
CREATE TABLE "basket_deposits" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "depositorAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL DEFAULT '0',
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "payoutAmount" TEXT,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "basket_deposits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "basket_deposits_basketId_depositorAddress_key" ON "basket_deposits"("basketId", "depositorAddress");
CREATE INDEX "basket_deposits_basketId_idx" ON "basket_deposits"("basketId");
CREATE INDEX "basket_deposits_depositorAddress_idx" ON "basket_deposits"("depositorAddress");

-- Add foreign key constraint for basket_deposits.basketId -> baskets.id
ALTER TABLE "basket_deposits" ADD CONSTRAINT "basket_deposits_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "baskets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
