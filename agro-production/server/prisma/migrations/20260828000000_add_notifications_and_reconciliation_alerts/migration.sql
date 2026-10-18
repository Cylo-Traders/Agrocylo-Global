-- Create Notification table for per-wallet notifications
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "orderId" TEXT,
    "campaignId" TEXT,
    "type" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_walletAddress_idx" ON "notifications"("walletAddress");
CREATE INDEX "notifications_walletAddress_createdAt_idx" ON "notifications"("walletAddress", "createdAt" DESC);
CREATE INDEX "notifications_walletAddress_isRead_idx" ON "notifications"("walletAddress", "isRead");
CREATE INDEX "notifications_orderId_idx" ON "notifications"("orderId");
CREATE INDEX "notifications_campaignId_idx" ON "notifications"("campaignId");

-- Create NotificationPreference table, one row per wallet
CREATE TABLE "notification_preferences" (
    "walletAddress" TEXT NOT NULL,
    "preferences" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("walletAddress")
);

-- Create ReconciliationAlert table for drift detected between DB and chain state
CREATE TABLE "reconciliation_alerts" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "contract_set" TEXT NOT NULL,
    "drift_type" TEXT NOT NULL,
    "db_value" JSONB NOT NULL,
    "chain_value" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "notes" TEXT,

    CONSTRAINT "reconciliation_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reconciliation_alerts_entity_type_entity_id_idx" ON "reconciliation_alerts"("entity_type", "entity_id");
CREATE INDEX "reconciliation_alerts_detected_at_idx" ON "reconciliation_alerts"("detected_at" DESC);
CREATE INDEX "reconciliation_alerts_resolved_at_idx" ON "reconciliation_alerts"("resolved_at");
CREATE INDEX "reconciliation_alerts_drift_type_idx" ON "reconciliation_alerts"("drift_type");
