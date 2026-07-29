-- CreateEnum for MessageType
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'FILE', 'SYSTEM');

-- Create Conversation table for order-scoped marketplace chat
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerAddress" TEXT NOT NULL,
    "sellerAddress" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversations_orderId_key" ON "conversations"("orderId");
CREATE INDEX "conversations_buyerAddress_idx" ON "conversations"("buyerAddress");
CREATE INDEX "conversations_sellerAddress_idx" ON "conversations"("sellerAddress");

-- Add foreign key constraint for conversations.orderId -> orders.id
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create Message table for conversation messages with soft delete support
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt" DESC);
CREATE INDEX "messages_senderAddress_idx" ON "messages"("senderAddress");

-- Add foreign key constraint for messages.conversationId -> conversations.id
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create ConversationParticipant table for per-participant read state (high-water-mark)
CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "lastReadMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversation_participants_conversationId_walletAddress_key" ON "conversation_participants"("conversationId", "walletAddress");
CREATE INDEX "conversation_participants_conversationId_idx" ON "conversation_participants"("conversationId");
CREATE INDEX "conversation_participants_walletAddress_idx" ON "conversation_participants"("walletAddress");

-- Add foreign key constraint for conversation_participants.conversationId -> conversations.id
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
