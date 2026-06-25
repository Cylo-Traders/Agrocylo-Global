-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('Open', 'EvidenceSubmitted', 'Resolved', 'Dismissed');

-- CreateTable: disputes
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "orderId" TEXT,
    "initiatorAddress" TEXT NOT NULL,
    "respondentAddress" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'Open',
    "resolutionOutcome" TEXT,
    "resolutionNotes" TEXT,
    "transactionHash" TEXT NOT NULL,
    "ledgerSequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "disputes_transactionHash_key" ON "disputes"("transactionHash");
CREATE INDEX "disputes_campaignId_idx" ON "disputes"("campaignId");
CREATE INDEX "disputes_orderId_idx" ON "disputes"("orderId");
CREATE INDEX "disputes_initiatorAddress_idx" ON "disputes"("initiatorAddress");
CREATE INDEX "disputes_respondentAddress_idx" ON "disputes"("respondentAddress");
CREATE INDEX "disputes_status_idx" ON "disputes"("status");
CREATE INDEX "disputes_transactionHash_idx" ON "disputes"("transactionHash");

-- CreateTable: dispute_evidence
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "submitterAddress" TEXT NOT NULL,
    "evidenceUrl" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dispute_evidence_disputeId_idx" ON "dispute_evidence"("disputeId");
CREATE INDEX "dispute_evidence_submitterAddress_idx" ON "dispute_evidence"("submitterAddress");

-- CreateTable: dispute_audit_entries
CREATE TABLE "dispute_audit_entries" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorAddress" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dispute_audit_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dispute_audit_entries_disputeId_idx" ON "dispute_audit_entries"("disputeId");
CREATE INDEX "dispute_audit_entries_createdAt_idx" ON "dispute_audit_entries"("createdAt");

-- AddForeignKeys
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "disputes" ADD CONSTRAINT "disputes_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_disputeId_fkey"
    FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dispute_audit_entries" ADD CONSTRAINT "dispute_audit_entries_disputeId_fkey"
    FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
