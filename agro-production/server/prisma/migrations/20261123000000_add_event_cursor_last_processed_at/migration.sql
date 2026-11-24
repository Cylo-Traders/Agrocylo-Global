-- AlterTable: event_cursors — contract-scoped processing timestamp (Issue #1344)
ALTER TABLE "event_cursors" ADD COLUMN "lastProcessedAt" TIMESTAMP(3);

-- Backfill from the cursor's own update time so existing cursors keep a
-- contract-specific freshness signal until their watcher next advances.
UPDATE "event_cursors" SET "lastProcessedAt" = "updatedAt" WHERE "lastProcessedAt" IS NULL;
