-- DropIndex
DROP INDEX "idx_investments_investor_created_desc";

-- AlterTable
ALTER TABLE "integrator_api_keys" ALTER COLUMN "expires_at" DROP DEFAULT;

-- CreateTable
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

-- CreateIndex
CREATE INDEX "reconciliation_alerts_entity_type_entity_id_idx" ON "reconciliation_alerts"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "reconciliation_alerts_detected_at_idx" ON "reconciliation_alerts"("detected_at" DESC);

-- CreateIndex
CREATE INDEX "reconciliation_alerts_resolved_at_idx" ON "reconciliation_alerts"("resolved_at");

-- CreateIndex
CREATE INDEX "reconciliation_alerts_drift_type_idx" ON "reconciliation_alerts"("drift_type");

-- RenameIndex
ALTER INDEX "locations_lat_lng_is_public_idx" RENAME TO "locations_latitude_longitude_is_public_idx";

-- RenameIndex
ALTER INDEX "products_category_isAvailable_createdAt_idx" RENAME TO "products_category_is_available_created_at_idx";

-- RenameIndex
ALTER INDEX "products_farmerWallet_createdAt_idx" RENAME TO "products_farmer_wallet_created_at_idx";

-- RenameIndex
ALTER INDEX "products_isAvailable_createdAt_idx" RENAME TO "products_is_available_created_at_idx";

