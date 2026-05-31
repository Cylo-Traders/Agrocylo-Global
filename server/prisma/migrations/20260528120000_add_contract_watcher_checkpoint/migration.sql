CREATE TABLE "contract_watcher_checkpoints" (
    "service" TEXT NOT NULL,
    "last_ledger" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_watcher_checkpoints_pkey" PRIMARY KEY ("service")
);
