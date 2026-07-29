import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import {
  jsonValidated,
  validateBody,
  validateParams,
  validateQuery,
  validateResponse,
} from "../middleware/validate.js";
import { problemDetail } from "../middleware/errors.js";
import { writeLimiter } from "../middleware/rateLimit.js";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";
import { broadcastTo } from "../services/wsServer.js";
import rateLimit from "express-rate-limit";
import { config } from "../config/index.js";

const router = Router();

// Marketplace conversation schemas
const ConversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

const OrderIdParamSchema = z.object({
  orderId: z.string().uuid(),
});

const MessagePaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const SendMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

const EditMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

// Response schemas
const MarketplaceMessageResponseSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderAddress: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

const MarketplaceConversationResponseSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  buyerAddress: z.string(),
  sellerAddress: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const MessageListResponseSchema = z.object({
  messages: z.array(MarketplaceMessageResponseSchema),
  nextCursor: z.string().optional(),
});

// Message rate limiter per wallet (stricter than default)
const messageRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: Math.max(1, config.rateLimitWriteMaxRequests),
  keyGenerator: (req: Request) => {
    const walletReq = req as WalletRequest;
    return walletReq.walletAddress || req.ip || "unknown";
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many messages",
    retryAfter: `${config.rateLimitWindowMs / 1000}s`,
  },
});

// Helper: Check if wallet is a participant in conversation
async function checkParticipant(
  conversationId: string,
  walletAddress: string,
): Promise<boolean> {
  const conversation = await prisma.marketplaceConversation.findUnique({
    where: { id: conversationId },
  });
  return (
    conversation &&
    (conversation.buyerAddress === walletAddress || conversation.sellerAddress === walletAddress)
  );
}

// GET /conversations — list user's conversations
router.get(
  "/conversations",
  requireWallet,
  validateResponse(z.array(MarketplaceConversationResponseSchema)),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;

    const conversations = await prisma.marketplaceConversation.findMany({
      where: {
        OR: [{ buyerAddress: walletAddress }, { sellerAddress: walletAddress }],
      },
      orderBy: { updatedAt: "desc" },
    });

    jsonValidated(res, z.array(MarketplaceConversationResponseSchema), 200, conversations);
  },
);

// POST /orders/:orderId/conversation — create/return conversation for order
router.post(
  "/orders/:orderId/conversation",
  requireWallet,
  writeLimiter,
  validateParams(OrderIdParamSchema),
  validateResponse(MarketplaceConversationResponseSchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { orderId } = req.params;

    // Fetch order and validate participants
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { campaign: true },
    });

    if (!order) {
      problemDetail(res, req, 404, "Order Not Found", `No order with id ${orderId}`);
      return;
    }

    // Only buyer or seller (farmer) can create/access conversation
    const isBuyer = walletAddress === order.buyerAddress;
    const isSeller = walletAddress === order.campaign.farmerAddress;

    if (!isBuyer && !isSeller) {
      problemDetail(
        res,
        req,
        403,
        "Forbidden",
        "Only order participants can access this conversation",
      );
      return;
    }

    // Find or create conversation
    let conversation = await prisma.marketplaceConversation.findUnique({
      where: { orderId },
    });

    if (!conversation) {
      conversation = await prisma.marketplaceConversation.create({
        data: {
          orderId,
          buyerAddress: order.buyerAddress,
          sellerAddress: order.campaign.farmerAddress,
        },
      });
    }

    jsonValidated(res, MarketplaceConversationResponseSchema, 200, conversation);
  },
);

// GET /conversations/:id/messages — paginated message history with cursor
router.get(
  "/conversations/:id/messages",
  requireWallet,
  validateParams(ConversationIdParamSchema),
  validateQuery(MessagePaginationSchema),
  validateResponse(MessageListResponseSchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id } = req.params;
    const { cursor, limit } = req.query as unknown as z.infer<typeof MessagePaginationSchema>;

    // Check authorization
    const isParticipant = await checkParticipant(id, walletAddress);
    if (!isParticipant) {
      problemDetail(
        res,
        req,
        403,
        "Forbidden",
        "You do not have access to this conversation",
      );
      return;
    }

    // Build query
    const where = {
      conversationId: id,
      deletedAt: null,
    };

    const orderBy = { createdAt: "desc" as const };

    // Apply cursor if provided
    let skip = 0;
    if (cursor) {
      const cursorMessage = await prisma.marketplaceMessage.findUnique({
        where: { id: cursor },
      });
      if (cursorMessage) {
        skip = 1;
        (where as any).createdAt = {
          lt: cursorMessage.createdAt,
        };
      }
    }

    // Fetch limit + 1 to determine if there's a next cursor
    const messages = await prisma.marketplaceMessage.findMany({
      where,
      orderBy,
      skip,
      take: limit + 1,
    });

    let nextCursor: string | undefined;
    if (messages.length > limit) {
      nextCursor = messages[limit]!.id;
      messages.pop();
    }

    // Reverse to return in chronological order
    messages.reverse();

    jsonValidated(res, MessageListResponseSchema, 200, {
      messages,
      nextCursor,
    });
  },
);

// POST /conversations/:id/messages — send a message
router.post(
  "/conversations/:id/messages",
  requireWallet,
  messageRateLimiter,
  validateParams(ConversationIdParamSchema),
  validateBody(SendMessageSchema),
  validateResponse(MarketplaceMessageResponseSchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id } = req.params;
    const { content } = req.body as z.infer<typeof SendMessageSchema>;

    // Check authorization
    const isParticipant = await checkParticipant(id, walletAddress);
    if (!isParticipant) {
      problemDetail(
        res,
        req,
        403,
        "Forbidden",
        "You do not have access to this conversation",
      );
      return;
    }

    // Fetch conversation to get other participant
    const conversation = await prisma.marketplaceConversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      problemDetail(res, req, 404, "Conversation Not Found", `No conversation with id ${id}`);
      return;
    }

    const message = await prisma.marketplaceMessage.create({
      data: {
        conversationId: id,
        senderAddress: walletAddress,
        content,
      },
    });

    // Update conversation updatedAt
    await prisma.marketplaceConversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    // Broadcast to other participant
    const recipientWallet = walletAddress === conversation.buyerAddress
      ? conversation.sellerAddress
      : conversation.buyerAddress;
    broadcastTo(recipientWallet, "message:new", {
      conversationId: id,
      message,
    });

    jsonValidated(res, MarketplaceMessageResponseSchema, 201, message);
  },
);

// PATCH /conversations/:id/messages/:messageId — edit message
router.patch(
  "/conversations/:id/messages/:messageId",
  requireWallet,
  writeLimiter,
  validateParams(
    z.object({
      id: z.string().uuid(),
      messageId: z.string().uuid(),
    }),
  ),
  validateBody(EditMessageSchema),
  validateResponse(MarketplaceMessageResponseSchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id, messageId } = req.params;
    const { content } = req.body as z.infer<typeof EditMessageSchema>;

    // Check authorization on conversation
    const isParticipant = await checkParticipant(id, walletAddress);
    if (!isParticipant) {
      problemDetail(
        res,
        req,
        403,
        "Forbidden",
        "You do not have access to this conversation",
      );
      return;
    }

    // Fetch message and verify sender
    const message = await prisma.marketplaceMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      problemDetail(res, req, 404, "Message Not Found", `No message with id ${messageId}`);
      return;
    }

    if (message.senderAddress !== walletAddress) {
      problemDetail(
        res,
        req,
        403,
        "Forbidden",
        "You can only edit your own messages",
      );
      return;
    }

    if (message.deletedAt) {
      problemDetail(res, req, 409, "Conflict", "Cannot edit a deleted message");
      return;
    }

    const updated = await prisma.marketplaceMessage.update({
      where: { id: messageId },
      data: { content },
    });

    // Fetch conversation to broadcast to other participant
    const conversation = await prisma.marketplaceConversation.findUnique({
      where: { id },
    });

    if (conversation) {
      const recipientWallet = walletAddress === conversation.buyerAddress
        ? conversation.sellerAddress
        : conversation.buyerAddress;
      broadcastTo(recipientWallet, "message:edited", {
        conversationId: id,
        message: updated,
      });
    }

    jsonValidated(res, MarketplaceMessageResponseSchema, 200, updated);
  },
);

// DELETE /conversations/:id/messages/:messageId — soft delete message
router.delete(
  "/conversations/:id/messages/:messageId",
  requireWallet,
  writeLimiter,
  validateParams(
    z.object({
      id: z.string().uuid(),
      messageId: z.string().uuid(),
    }),
  ),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id, messageId } = req.params;

    // Check authorization on conversation
    const isParticipant = await checkParticipant(id, walletAddress);
    if (!isParticipant) {
      problemDetail(
        res,
        req,
        403,
        "Forbidden",
        "You do not have access to this conversation",
      );
      return;
    }

    // Fetch message and verify sender
    const message = await prisma.marketplaceMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      problemDetail(res, req, 404, "Message Not Found", `No message with id ${messageId}`);
      return;
    }

    if (message.senderAddress !== walletAddress) {
      problemDetail(
        res,
        req,
        403,
        "Forbidden",
        "You can only delete your own messages",
      );
      return;
    }

    if (message.deletedAt) {
      problemDetail(res, req, 409, "Conflict", "Message is already deleted");
      return;
    }

    const deletedMessage = await prisma.marketplaceMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    // Fetch conversation to broadcast to other participant
    const conversation = await prisma.marketplaceConversation.findUnique({
      where: { id },
    });

    if (conversation) {
      const recipientWallet = walletAddress === conversation.buyerAddress
        ? conversation.sellerAddress
        : conversation.buyerAddress;
      broadcastTo(recipientWallet, "message:deleted", {
        conversationId: id,
        messageId,
      });
    }

    res.status(204).send();
  },
);

// POST /conversations/:id/read — mark conversation as read (update high-water-mark)
router.post(
  "/conversations/:id/read",
  requireWallet,
  validateParams(ConversationIdParamSchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id } = req.params;

    // Check authorization
    const isParticipant = await checkParticipant(id, walletAddress);
    if (!isParticipant) {
      problemDetail(
        res,
        req,
        403,
        "Forbidden",
        "You do not have access to this conversation",
      );
      return;
    }

    // Update conversation's updatedAt to track read state
    const conversation = await prisma.marketplaceConversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    jsonValidated(res, MarketplaceConversationResponseSchema, 200, conversation);
  },
);

export default router;
