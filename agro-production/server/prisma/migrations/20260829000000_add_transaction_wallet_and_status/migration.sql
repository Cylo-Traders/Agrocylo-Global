-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('awaiting_signature', 'submitted', 'confirmed', 'indexed', 'failed');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "walletAddress" TEXT,
ADD COLUMN "status" "TransactionStatus" NOT NULL DEFAULT 'submitted';

-- CreateIndex
CREATE INDEX "transactions_walletAddress_idx" ON "transactions"("walletAddress");

-- CreateIndex
CREATE INDEX "transactions_txHash_idx" ON "transactions"("txHash");
