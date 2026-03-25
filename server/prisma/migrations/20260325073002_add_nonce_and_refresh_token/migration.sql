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
CREATE TABLE "Nonce" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_walletAddress_idx" ON "Notification"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Nonce_walletAddress_key" ON "Nonce"("walletAddress");

-- CreateIndex
CREATE INDEX "Nonce_walletAddress_idx" ON "Nonce"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_walletAddress_idx" ON "RefreshToken"("walletAddress");
