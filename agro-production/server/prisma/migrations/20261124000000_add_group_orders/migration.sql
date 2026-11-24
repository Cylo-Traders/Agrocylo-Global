-- Issue #1257: Group Orders API. The production client's
-- `/group-orders` page already calls `GET /api/group-orders` and
-- `POST /api/group-orders/:id/join`; this migration adds the backing
-- schema those routes write to.

-- CreateEnum
CREATE TYPE "GroupOrderStatus" AS ENUM ('OPEN', 'EXPIRED', 'COMPLETED');

-- CreateTable: group_orders
CREATE TABLE "group_orders" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "pricePerUnit" TEXT NOT NULL,
    "targetQuantity" INTEGER NOT NULL,
    "currentQuantity" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "GroupOrderStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "group_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_orders_status_idx" ON "group_orders"("status");
CREATE INDEX "group_orders_expiresAt_idx" ON "group_orders"("expiresAt");

-- CreateTable: group_order_participants
-- The unique index on (groupOrderId, participantAddress) is what makes
-- the join idempotent: a duplicate insert raises a unique violation
-- that the route surfaces as a 409, so a retry of a successful join
-- can never advance the parent's currentQuantity twice.
CREATE TABLE "group_order_participants" (
    "id" TEXT NOT NULL,
    "groupOrderId" TEXT NOT NULL,
    "participantAddress" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_order_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "group_order_participants_groupOrderId_participantAddress_key"
    ON "group_order_participants"("groupOrderId", "participantAddress");
CREATE INDEX "group_order_participants_participantAddress_idx"
    ON "group_order_participants"("participantAddress");

ALTER TABLE "group_order_participants"
    ADD CONSTRAINT "group_order_participants_groupOrderId_fkey"
    FOREIGN KEY ("groupOrderId") REFERENCES "group_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
