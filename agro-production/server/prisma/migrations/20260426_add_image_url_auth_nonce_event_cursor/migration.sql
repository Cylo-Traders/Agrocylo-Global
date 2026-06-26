-- Add imageUrl to campaigns
ALTER TABLE "campaigns" ADD COLUMN "imageUrl" TEXT;

-- Create AuthNonce table
CREATE TABLE "auth_nonces" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'agro-production',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_nonces_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_nonces_nonce_key" ON "auth_nonces"("nonce");
CREATE INDEX "auth_nonces_nonce_idx" ON "auth_nonces"("nonce");
CREATE INDEX "auth_nonces_walletAddress_idx" ON "auth_nonces"("walletAddress");

-- Create EventCursor table
CREATE TABLE "event_cursors" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_cursors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_cursors_contractId_key" ON "event_cursors"("contractId");
