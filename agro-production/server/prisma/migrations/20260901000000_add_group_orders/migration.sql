-- CreateEnum
CREATE TYPE "GroupOrderStatus" AS ENUM ('open', 'expired', 'completed');

-- CreateTable
CREATE TABLE "group_orders" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "currentQuantity" INTEGER NOT NULL DEFAULT 0,
    "targetQuantity" INTEGER NOT NULL,
    "pricePerUnit" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "GroupOrderStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_orders_status_idx" ON "group_orders"("status");
CREATE INDEX "group_orders_expiresAt_idx" ON "group_orders"("expiresAt");

-- CreateTable
CREATE TABLE "group_order_participants" (
    "id" TEXT NOT NULL,
    "groupOrderId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_order_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "group_order_participants_groupOrderId_walletAddress_key" ON "group_order_participants"("groupOrderId", "walletAddress");
CREATE INDEX "group_order_participants_groupOrderId_idx" ON "group_order_participants"("groupOrderId");
CREATE INDEX "group_order_participants_walletAddress_idx" ON "group_order_participants"("walletAddress");

-- AddForeignKey
ALTER TABLE "group_order_participants" ADD CONSTRAINT "group_order_participants_groupOrderId_fkey" FOREIGN KEY ("groupOrderId") REFERENCES "group_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
