CREATE TABLE "governance_proposals" (
  "id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "proposer" TEXT,
  "target_contract" TEXT,
  "function_name" TEXT,
  "status" TEXT NOT NULL,
  "votes_for" TEXT NOT NULL DEFAULT '0',
  "votes_against" TEXT NOT NULL DEFAULT '0',
  "source_event_id" TEXT NOT NULL,
  "ledger" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governance_proposals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_votes" (
  "id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "voter" TEXT NOT NULL,
  "support" BOOLEAN NOT NULL,
  "weight" TEXT NOT NULL,
  "source_event_id" TEXT NOT NULL,
  "ledger" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "governance_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "governance_proposals_proposal_id_key" ON "governance_proposals"("proposal_id");
CREATE UNIQUE INDEX "governance_proposals_source_event_id_key" ON "governance_proposals"("source_event_id");
CREATE INDEX "governance_proposals_status_idx" ON "governance_proposals"("status");
CREATE UNIQUE INDEX "governance_votes_source_event_id_key" ON "governance_votes"("source_event_id");
CREATE UNIQUE INDEX "governance_votes_proposal_id_voter_key" ON "governance_votes"("proposal_id", "voter");
CREATE INDEX "governance_votes_proposal_id_idx" ON "governance_votes"("proposal_id");
ALTER TABLE "governance_votes" ADD CONSTRAINT "governance_votes_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "governance_proposals"("proposal_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
