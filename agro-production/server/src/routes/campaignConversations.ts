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

// Campaign conversation schemas
const ConversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

const CampaignIdParamSchema = z.object({
  campaignId: z.string().uuid(),
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
const MessageResponseSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderAddress: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

const ConversationResponseSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  farmerAddress: z.string(),
  investorAddress: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const MessageListResponseSchema = z.object({
  messages: z.array(MessageResponseSchema),
  nextCursor: z.string().optional(),
});

// Message rate limiter per wallet
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
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  return (
    conversation &&
    (conversation.farmerAddress === walletAddress || conversation.investorAddress === walletAddress)
  );
}

// Helper: Check if wallet can access campaign conversation
async function canAccessCampaignConversation(
  campaignId: string,
  walletAddress: string,
): Promise<boolean> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) return false;

  const isFarmer = campaign.farmerAddress === walletAddress;
  if (isFarmer) return true;

  // Check if investor has an investment in this campaign
  const investment = await prisma.investment.findFirst({
    where: {
      campaignId,
      investorAddress: walletAddress,
    },
  });

  return !!investment;
}

// GET /campaigns/:campaignId/conversation — get or list conversation for campaign
router.get(
  "/campaigns/:campaignId/conversation",
  requireWallet,
  validateParams(CampaignIdParamSchema),
  validateResponse(ConversationResponseSchema.or(z.null())),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { campaignId } = req.params;

    // Check access to campaign
    const canAccess = await canAccessCampaignConversation(campaignId, walletAddress);
    if (!canAccess) {
      problemDetail(
        res,
        req,
        403,
        "Forbidden",
        "Only farmer or investors can access campaign conversations",
      );
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        campaignId,
        OR: [
          { investorAddress: walletAddress },
          { farmerAddress: walletAddress },
        ],
      },
    });

    jsonValidated(res, ConversationResponseSchema.or(z.null()), 200, conversation || null);
  },
);

// POST /campaigns/:campaignId/conversation — create conversation for campaign
router.post(
  "/campaigns/:campaignId/conversation",
  requireWallet,
  writeLimiter,
  validateParams(CampaignIdParamSchema),
  validateResponse(ConversationResponseSchema),
  async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { campaignId } = req.params;

    // Fetch campaign
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      problemDetail(res, req, 404, "Campaign Not Found", `No campaign with id ${campaignId}`);
      return;
    }

    const isFarmer = walletAddress === campaign.farmerAddress;

    // Investor: must have an investment
    if (!isFarmer) {
      const investment = await prisma.investment.findFirst({
        where: {
          campaignId,
          investorAddress: walletAddress,
        },
      });

      if (!investment) {
        problemDetail(
          res,
          req,
          403,
          "Forbidden",
          "Only campaign investors and farmer can create conversations",
        );
        return;
      }
    }

    // Determine roles
    const farmerAddress = campaign.farmerAddress;
    const investorAddress = isFarmer ? "unknown" : walletAddress;

    // For farmer: find or create with requesting investor (will be set in body or error)
    if (isFarmer) {
      problemDetail(
        res,
        req,
        400,
        "Bad Request",
        "Farmer cannot initiate conversation; investors initiate by investing",
      );
      return;
    }

    // Find or create conversation (unique on campaignId + investorAddress)
    let conversation = await prisma.conversation.findFirst({
      where: {
        campaignId,
        investorAddress: walletAddress,
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          campaignId,
          farmerAddress,
          investorAddress: walletAddress,
        },
      });
    }

    jsonValidated(res, ConversationResponseSchema, 200, conversation);
  },
);

// GET /conversations/:id/messages — paginated message history
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
      const cursorMessage = await prisma.message.findUnique({
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
    const messages = await prisma.message.findMany({
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
  validateResponse(MessageResponseSchema),
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
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      problemDetail(res, req, 404, "Conversation Not Found", `No conversation with id ${id}`);
      return;
    }

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        senderAddress: walletAddress,
        content,
      },
    });

    // Update conversation updatedAt
    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    // Broadcast to other participant
    const recipientWallet = walletAddress === conversation.farmerAddress
      ? conversation.investorAddress
      : conversation.farmerAddress;
    broadcastTo(recipientWallet, "message:new", {
      conversationId: id,
      message,
    });

    jsonValidated(res, MessageResponseSchema, 201, message);
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
  validateResponse(MessageResponseSchema),
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
    const message = await prisma.message.findUnique({
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

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content },
    });

    // Fetch conversation to broadcast to other participant
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (conversation) {
      const recipientWallet = walletAddress === conversation.farmerAddress
        ? conversation.investorAddress
        : conversation.farmerAddress;
      broadcastTo(recipientWallet, "message:edited", {
        conversationId: id,
        message: updated,
      });
    }

    jsonValidated(res, MessageResponseSchema, 200, updated);
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
    const message = await prisma.message.findUnique({
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

    await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    // Fetch conversation to broadcast to other participant
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (conversation) {
      const recipientWallet = walletAddress === conversation.farmerAddress
        ? conversation.investorAddress
        : conversation.farmerAddress;
      broadcastTo(recipientWallet, "message:deleted", {
        conversationId: id,
        messageId,
      });
    }

    res.status(204).send();
  },
);

// POST /conversations/:id/read — mark conversation as read
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

    // Update conversation's updatedAt
    const conversation = await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    jsonValidated(res, ConversationResponseSchema, 200, conversation);
  },
);

export default router;
