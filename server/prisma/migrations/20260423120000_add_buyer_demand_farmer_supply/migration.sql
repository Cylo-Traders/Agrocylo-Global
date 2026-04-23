-- Buyer demand (buyer expresses what they need)
CREATE TABLE "buyer_demands" (
    "id" TEXT NOT NULL,
    "buyer_wallet" TEXT NOT NULL,
    "crop_name" TEXT NOT NULL,
    "quantity_wanted" TEXT,
    "unit" TEXT,
    "max_price_per_unit" TEXT,
    "currency" TEXT,
    "region" TEXT,
    "notes" TEXT,
    "needed_by" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_demands_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "buyer_demands_buyer_wallet_idx" ON "buyer_demands"("buyer_wallet");

-- Farmer supply (inventory / availability linked to farmer wallet)
CREATE TABLE "farmer_supplies" (
    "id" TEXT NOT NULL,
    "farmer_wallet" TEXT NOT NULL,
    "crop_name" TEXT NOT NULL,
    "quantity_available" TEXT NOT NULL,
    "unit" TEXT,
    "price_per_unit" TEXT,
    "currency" TEXT,
    "available_from" TIMESTAMP(3),
    "available_until" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farmer_supplies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "farmer_supplies_farmer_wallet_idx" ON "farmer_supplies"("farmer_wallet");
