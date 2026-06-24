-- Add indexes for order queries
CREATE INDEX IF NOT EXISTS "orders_sellerAddress_idx" ON "orders"("sellerAddress");
CREATE INDEX IF NOT EXISTS "orders_buyerAddress_idx" ON "orders"("buyerAddress");
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders"("status");
CREATE INDEX IF NOT EXISTS "orders_createdAt_idx" ON "orders"("createdAt" DESC);

-- Add composite index for seller stats queries
CREATE INDEX IF NOT EXISTS "orders_sellerAddress_status_idx" ON "orders"("sellerAddress", "status");

-- Add indexes for notification queries
CREATE INDEX IF NOT EXISTS "Notification_walletAddress_createdAt_idx" ON "Notification"("walletAddress", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Notification_walletAddress_isRead_idx" ON "Notification"("walletAddress", "isRead");
CREATE INDEX IF NOT EXISTS "Notification_orderId_idx" ON "Notification"("orderId");

-- Add index for dispute queries
CREATE INDEX IF NOT EXISTS "disputes_orderIdOnChain_idx" ON "disputes"("orderIdOnChain");
