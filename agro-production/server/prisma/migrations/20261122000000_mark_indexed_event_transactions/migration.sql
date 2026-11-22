-- Backfill event-derived transaction rows to the status the reconciler queries.
-- ASSUMPTION (maintainer review required): a row with a tx hash, a real ledger
-- and an event type other than the REST-only order intent was ingested from an
-- on-chain event, so its authoritative status is `indexed`.
UPDATE "transactions"
SET status = 'indexed'
WHERE status = 'submitted'
  AND ledger > 0
  AND "txHash" IS NOT NULL
  AND eventType <> 'order.created_intent';
