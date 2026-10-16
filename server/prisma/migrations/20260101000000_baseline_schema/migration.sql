
-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "farmer_wallet" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "price_per_unit" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "stock_quantity" DECIMAL(10,2),
    "image_url" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price_tiers" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "min_quantity" DECIMAL(10,2) NOT NULL,
    "price_per_unit" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "buyer_wallet" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "farmer_wallet" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cart_items_positive_quantity" CHECK ("quantity" > 0),
    CONSTRAINT "cart_items_cart_id_product_id_key" UNIQUE ("cart_id", "product_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderIdOnChain" TEXT NOT NULL,
    "buyerAddress" TEXT NOT NULL,
    "sellerAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "productId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "campaignIdOnChain" TEXT NOT NULL,
    "creatorAddress" TEXT NOT NULL,
    "goalAmount" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investments" (
    "id" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "campaignIdOnChain" TEXT NOT NULL,
    "investorAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "txHash" TEXT,
    "orderIdOnChain" TEXT,
    "campaignIdOnChain" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escrow_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_transactions" (
    "id" TEXT NOT NULL,
    "orderIdOnChain" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escrow_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "productId" UUID NOT NULL,
    "price" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "wallet_address" TEXT NOT NULL,
    "display_name" TEXT,
    "bio" TEXT,
    "avatar_url" TEXT,
    "role" TEXT NOT NULL DEFAULT 'BUYER',

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("wallet_address")
);

-- CreateTable
CREATE TABLE "locations" (
    "wallet_address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("wallet_address")
);

-- CreateTable
CREATE TABLE "price_index" (
    "id" TEXT NOT NULL,
    "crop" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "avg_price" DOUBLE PRECISION NOT NULL,
    "min_price" DOUBLE PRECISION NOT NULL,
    "max_price" DOUBLE PRECISION NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "source_counts" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_readings" (
    "id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "temperature_c" DOUBLE PRECISION NOT NULL,
    "precipitation_mm" DOUBLE PRECISION NOT NULL,
    "wind_speed_kph" DOUBLE PRECISION NOT NULL,
    "condition_code" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "attested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_metadata" (
    "on_chain_order_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "farmer_address" TEXT NOT NULL,
    "buyer_address" TEXT NOT NULL,

    CONSTRAINT "order_metadata_pkey" PRIMARY KEY ("on_chain_order_id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "orderIdOnChain" TEXT NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT,
    "evidenceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "subject_wallet" TEXT NOT NULL,
    "reviewer_wallet" TEXT NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "reviewer_role" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "transaction_hash" TEXT NOT NULL,
    "verified_transaction" BOOLEAN NOT NULL DEFAULT true,
    "helpful_votes" INTEGER NOT NULL DEFAULT 0,
    "helpful_vote_wallets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "response_message" TEXT,
    "responder_name" TEXT,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_orders" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "farmer_wallet" TEXT NOT NULL,
    "target_quantity" DECIMAL(10,2) NOT NULL,
    "committed_quantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "window_ends_at" TIMESTAMP(3) NOT NULL,
    "batch_tx_hash" TEXT,
    "fulfilled_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "group_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_order_contributions" (
    "id" UUID NOT NULL,
    "group_order_id" UUID NOT NULL,
    "buyer_wallet" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "order_id_on_chain" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "group_order_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_links" (
    "phoneNumber" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_links_pkey" PRIMARY KEY ("phoneNumber")
);

-- CreateTable
CREATE TABLE "ussd_sessions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'main_menu',
    "state" JSONB NOT NULL DEFAULT '{}',
    "wallet_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ussd_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_walletAddress_idx" ON "Notification"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "users_walletAddress_key" ON "users"("walletAddress");

-- CreateIndex
CREATE INDEX "products_farmer_wallet_is_available_idx" ON "products"("farmer_wallet", "is_available");

-- CreateIndex
CREATE INDEX "product_price_tiers_product_id_idx" ON "product_price_tiers"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_price_tiers_product_id_min_quantity_key" ON "product_price_tiers"("product_id", "min_quantity");

-- CreateIndex
CREATE INDEX "carts_buyer_wallet_idx" ON "carts"("buyer_wallet");

-- CreateIndex
CREATE UNIQUE INDEX "carts_one_active_per_buyer_idx" ON "carts"("buyer_wallet") WHERE "status" = 'active';

-- CreateIndex
CREATE INDEX "cart_items_cart_id_farmer_wallet_idx" ON "cart_items"("cart_id", "farmer_wallet");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_idx" ON "cart_items"("cart_id");

-- CreateIndex
CREATE INDEX "cart_items_product_id_idx" ON "cart_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderIdOnChain_key" ON "orders"("orderIdOnChain");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_campaignIdOnChain_key" ON "campaigns"("campaignIdOnChain");

-- CreateIndex
CREATE INDEX "campaigns_creatorAddress_idx" ON "campaigns"("creatorAddress");

-- CreateIndex
CREATE UNIQUE INDEX "investments_sourceEventId_key" ON "investments"("sourceEventId");

-- CreateIndex
CREATE INDEX "investments_campaignIdOnChain_idx" ON "investments"("campaignIdOnChain");

-- CreateIndex
CREATE INDEX "investments_investorAddress_idx" ON "investments"("investorAddress");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_sourceEventId_key" ON "transactions"("sourceEventId");

-- CreateIndex
CREATE INDEX "transactions_orderIdOnChain_idx" ON "transactions"("orderIdOnChain");

-- CreateIndex
CREATE INDEX "transactions_campaignIdOnChain_idx" ON "transactions"("campaignIdOnChain");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_ledger_eventIndex_key" ON "transactions"("ledger", "eventIndex");

-- CreateIndex
CREATE UNIQUE INDEX "escrow_events_ledger_eventIndex_key" ON "escrow_events"("ledger", "eventIndex");

-- CreateIndex
CREATE INDEX "price_index_crop_region_idx" ON "price_index"("crop", "region");

-- CreateIndex
CREATE UNIQUE INDEX "price_index_crop_region_currency_key" ON "price_index"("crop", "region", "currency");

-- CreateIndex
CREATE INDEX "weather_readings_wallet_address_recorded_at_idx" ON "weather_readings"("wallet_address", "recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "disputes_orderIdOnChain_key" ON "disputes"("orderIdOnChain");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_transaction_hash_key" ON "reviews"("transaction_hash");

-- CreateIndex
CREATE INDEX "reviews_subject_wallet_created_at_idx" ON "reviews"("subject_wallet", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_reviewer_wallet_idx" ON "reviews"("reviewer_wallet");

-- CreateIndex
CREATE INDEX "group_orders_product_id_status_idx" ON "group_orders"("product_id", "status");

-- CreateIndex
CREATE INDEX "group_orders_farmer_wallet_status_idx" ON "group_orders"("farmer_wallet", "status");

-- CreateIndex
CREATE INDEX "group_orders_window_ends_at_idx" ON "group_orders"("window_ends_at");

-- CreateIndex
CREATE INDEX "group_order_contributions_group_order_id_buyer_wallet_idx" ON "group_order_contributions"("group_order_id", "buyer_wallet");

-- CreateIndex
CREATE INDEX "group_order_contributions_buyer_wallet_status_idx" ON "group_order_contributions"("buyer_wallet", "status");

-- CreateIndex
CREATE INDEX "phone_links_wallet_address_idx" ON "phone_links"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "ussd_sessions_session_id_key" ON "ussd_sessions"("session_id");

-- CreateIndex
CREATE INDEX "ussd_sessions_phone_number_idx" ON "ussd_sessions"("phone_number");

-- CreateIndex
CREATE INDEX "ussd_sessions_session_id_expires_at_idx" ON "ussd_sessions"("session_id", "expires_at");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_farmer_wallet_fkey" FOREIGN KEY ("farmer_wallet") REFERENCES "profiles"("wallet_address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_tiers" ADD CONSTRAINT "product_price_tiers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_buyer_wallet_fkey" FOREIGN KEY ("buyer_wallet") REFERENCES "profiles"("wallet_address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyerAddress_fkey" FOREIGN KEY ("buyerAddress") REFERENCES "users"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sellerAddress_fkey" FOREIGN KEY ("sellerAddress") REFERENCES "users"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "profiles"("wallet_address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_orderIdOnChain_fkey" FOREIGN KEY ("orderIdOnChain") REFERENCES "orders"("orderIdOnChain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_wallet_fkey" FOREIGN KEY ("subject_wallet") REFERENCES "profiles"("wallet_address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_orders" ADD CONSTRAINT "group_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_order_contributions" ADD CONSTRAINT "group_order_contributions_group_order_id_fkey" FOREIGN KEY ("group_order_id") REFERENCES "group_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

