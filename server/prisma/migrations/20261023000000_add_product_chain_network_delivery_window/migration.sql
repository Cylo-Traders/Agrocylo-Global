-- Add Product fields introduced for multi-chain support and delivery windows.
-- These were added to schema.prisma without a corresponding migration, which
-- caused every product query/write to fail with "column does not exist".
ALTER TABLE "products" ADD COLUMN "chain_network" TEXT DEFAULT 'stellar:pubnet';
ALTER TABLE "products" ADD COLUMN "delivery_window" TEXT;
