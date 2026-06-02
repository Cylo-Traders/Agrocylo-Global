-- CreateTable
CREATE TABLE "notification_preferences" (
    "walletAddress" TEXT NOT NULL,
    "preferences" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("walletAddress")
);
