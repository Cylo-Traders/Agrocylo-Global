-- CreateTable
CREATE TABLE "crop_plans" (
    "id" TEXT NOT NULL,
    "farmer_wallet" TEXT NOT NULL,
    "crop_name" TEXT NOT NULL,
    "planted_date" TIMESTAMP(3) NOT NULL,
    "expected_harvest_start" TIMESTAMP(3) NOT NULL,
    "expected_harvest_end" TIMESTAMP(3) NOT NULL,
    "expected_volume" DOUBLE PRECISION,
    "unit" TEXT,
    "region" TEXT,
    "linked_campaign_id" TEXT,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 7,
    "reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crop_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crop_plans_farmer_wallet_idx" ON "crop_plans"("farmer_wallet");

-- CreateIndex
CREATE INDEX "crop_plans_expected_harvest_start_idx" ON "crop_plans"("expected_harvest_start");

-- CreateTable
CREATE TABLE "equipment_listings" (
    "id" TEXT NOT NULL,
    "owner_wallet" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "listing_type" TEXT NOT NULL,
    "price_per_unit" TEXT NOT NULL,
    "deposit_amount" TEXT NOT NULL DEFAULT '0',
    "currency" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "location" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_listings_owner_wallet_idx" ON "equipment_listings"("owner_wallet");

-- CreateIndex
CREATE INDEX "equipment_listings_listing_type_idx" ON "equipment_listings"("listing_type");

-- CreateTable
CREATE TABLE "equipment_rentals" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "renter_wallet" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deposit_amount" TEXT NOT NULL,
    "deposit_refunded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_rentals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_rentals_listing_id_idx" ON "equipment_rentals"("listing_id");

-- CreateIndex
CREATE INDEX "equipment_rentals_renter_wallet_idx" ON "equipment_rentals"("renter_wallet");

-- AddForeignKey
ALTER TABLE "equipment_rentals" ADD CONSTRAINT "equipment_rentals_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "equipment_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
