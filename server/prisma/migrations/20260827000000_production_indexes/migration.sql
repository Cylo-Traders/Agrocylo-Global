-- Database Production Readiness: Proposed Indexes for Risky Query Shapes

-- Index 1: Campaign listing with pagination + aggregate joins
-- Query pattern: SELECT c.* FROM campaigns WHERE c.status IN (...) ORDER BY c."createdAt" DESC LIMIT 20 OFFSET N
-- This partial index filters to active statuses and enables index-only scans for sorted pagination.
CREATE INDEX IF NOT EXISTS idx_campaigns_status_created_desc
  ON campaigns (status, "createdAt" DESC)
  WHERE status IN ('Active', 'FUNDING', 'FUNDED', 'IN_PRODUCTION', 'HARVESTED');

-- Index 2: Investment lookups by investorAddress across campaigns
-- Query pattern: SELECT i.* FROM investments WHERE i."investorAddress" = $1 ORDER BY i."createdAt" DESC LIMIT N
-- This composite index covers both the WHERE and ORDER BY clauses.
CREATE INDEX IF NOT EXISTS idx_investments_investor_created_desc
  ON investments ("investorAddress", "createdAt" DESC);

-- Index 3: Verify BlockchainTransaction unique constraint
-- Query pattern: SELECT * FROM transactions WHERE ledger = $1 AND event_index = $2
-- Already defined in Prisma schema as @@unique([ledger, eventIndex]), which auto-creates an index.
-- No additional index needed; the unique constraint index handles this query.
-- Verify in production via: SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'transactions' AND constraint_type = 'UNIQUE';
