-- CreateTable
CREATE TABLE "integrator_api_keys" (
    "id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "organization_name" TEXT NOT NULL,
    "scoped_farmer_wallets" TEXT[],
    "scoped_region" TEXT,
    "created_by_admin" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrator_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integrator_api_keys_key_hash_key" ON "integrator_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "integrator_api_keys_organization_name_idx" ON "integrator_api_keys"("organization_name");

-- CreateTable
CREATE TABLE "integrator_api_key_usage" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "ip_address" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrator_api_key_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integrator_api_key_usage_api_key_id_idx" ON "integrator_api_key_usage"("api_key_id");

-- CreateIndex
CREATE INDEX "integrator_api_key_usage_api_key_id_requested_at_idx" ON "integrator_api_key_usage"("api_key_id", "requested_at" DESC);

-- AddForeignKey
ALTER TABLE "integrator_api_key_usage" ADD CONSTRAINT "integrator_api_key_usage_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "integrator_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
