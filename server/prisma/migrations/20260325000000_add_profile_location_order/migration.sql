-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FARMER', 'BUYER');

-- CreateTable
CREATE TABLE "Profile" (
    "id" SERIAL NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "name" TEXT,
    "bio" TEXT,
    "avatar_url" TEXT,
    "role" "Role" NOT NULL DEFAULT 'BUYER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMetadata" (
    "id" SERIAL NOT NULL,
    "on_chain_order_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "farmer_address" TEXT NOT NULL,
    "buyer_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_wallet_address_key" ON "Profile"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "Location_wallet_address_key" ON "Location"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMetadata_on_chain_order_id_key" ON "OrderMetadata"("on_chain_order_id");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_wallet_address_fkey" 
FOREIGN KEY ("wallet_address") REFERENCES "Profile"("wallet_address") ON DELETE RESTRICT ON UPDATE CASCADE;
