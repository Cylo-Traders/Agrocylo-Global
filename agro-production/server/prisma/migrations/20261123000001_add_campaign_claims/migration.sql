-- CreateTable: campaign_claims — direct campaign payouts (Issue #1343)
CREATE TABLE "campaign_claims" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "investorAddress" TEXT NOT NULL,
    "payoutAmount" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_claims_campaignId_investorAddress_key" ON "campaign_claims"("campaignId", "investorAddress");
CREATE INDEX "campaign_claims_investorAddress_idx" ON "campaign_claims"("investorAddress");

ALTER TABLE "campaign_claims" ADD CONSTRAINT "campaign_claims_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
