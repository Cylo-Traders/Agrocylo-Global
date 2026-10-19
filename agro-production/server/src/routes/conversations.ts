import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import {
  jsonValidated,
  validateBody,
  validateParams,
  validateQuery,
  validateResponse,
} from '../middleware/validate.js';
import { problemDetail } from '../middleware/errors.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { broadcastTo } from '../services/wsServer.js';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Campaign (farmer/investor) conversation schemas
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

const BlockUserSchema = z.object({
  blockedAddress: z.string().min(1),
});

const ReportMessageSchema = z.object({
  reason: z.string().min(1).max(1000),
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

const BlockedUserResponseSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  blockerAddress: z.string(),
  blockedAddress: z.string(),
});

const MessageReportResponseSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  reporterAddress: z.string(),
  reason: z.string(),
});

// Message rate limiter per wallet
const messageRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: Math.max(1, config.rateLimitWriteMaxRequests),
  keyGenerator: (req: Request) => {
    const walletReq = req as WalletRequest;
    return walletReq.walletAddress || req.ip || 'unknown';
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many messages',
    retryAfter: `${config.rateLimitWindowMs / 1000}s`,
  },
});

interface ParticipantCheck {
  conversation: NonNullable<
    Awaited<ReturnType<typeof prisma.conversation.findUnique>>
  >;
  otherParty: string;
}

// Helper: check if wallet is a participant in the conversation (farmer or
// investor), returning the conversation and the *other* party's address for
// blocked-status checks and broadcast targeting. Wallet addresses are
// compared case-insensitively since callers may present them in either case.
async function checkParticipant(
  conversationId: string,
  walletAddress: string,
): Promise<ParticipantCheck | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) return null;

  const wallet = walletAddress.toLowerCase();
  if (wallet === conversation.investorAddress.toLowerCase()) {
    return { conversation, otherParty: conversation.farmerAddress };
  }
  if (wallet === conversation.farmerAddress.toLowerCase()) {
    return { conversation, otherParty: conversation.investorAddress };
  }
  return null;
}

// Helper: check if wallet can access (create a conversation for) a campaign
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

// GET /campaigns/:campaignId/conversation — get conversation for campaign
router.get(
  '/campaigns/:campaignId/conversation',
  requireWallet,
  validateParams(CampaignIdParamSchema),
  validateResponse(ConversationResponseSchema.or(z.null())),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { campaignId } = req.params;

    const canAccess = await canAccessCampaignConversation(
      campaignId,
      walletAddress,
    );
    if (!canAccess) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'Only farmer or investors can access campaign conversations',
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

    jsonValidated(
      res,
      ConversationResponseSchema.or(z.null()),
      200,
      conversation || null,
    );
  }),
);

// POST /campaigns/:campaignId/conversation — create conversation for campaign
router.post(
  '/campaigns/:campaignId/conversation',
  requireWallet,
  writeLimiter,
  validateParams(CampaignIdParamSchema),
  validateResponse(ConversationResponseSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { campaignId } = req.params;

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      problemDetail(
        res,
        req,
        404,
        'Campaign Not Found',
        `No campaign with id ${campaignId}`,
      );
      return;
    }

    const isFarmer = walletAddress === campaign.farmerAddress;

    if (isFarmer) {
      problemDetail(
        res,
        req,
        400,
        'Bad Request',
        'Farmer cannot initiate conversation; investors initiate by investing',
      );
      return;
    }

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
        'Forbidden',
        'Only campaign investors and farmer can create conversations',
      );
      return;
    }

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
          farmerAddress: campaign.farmerAddress,
          investorAddress: walletAddress,
        },
      });
    }

    jsonValidated(res, ConversationResponseSchema, 200, conversation);
  }),
);

// GET /conversations/:id/messages — paginated message history
router.get(
  '/conversations/:id/messages',
  requireWallet,
  validateParams(ConversationIdParamSchema),
  validateQuery(MessagePaginationSchema),
  validateResponse(MessageListResponseSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id } = req.params;
    const { cursor, limit } = req.query as unknown as z.infer<
      typeof MessagePaginationSchema
    >;

    const participantCheck = await checkParticipant(id, walletAddress);
    if (!participantCheck) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You do not have access to this conversation',
      );
      return;
    }

    const where = {
      conversationId: id,
      deletedAt: null,
    };

    const orderBy = { createdAt: 'desc' as const };

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

    const messages = await prisma.message.findMany({
      where,
      orderBy,
      skip,
      take: limit + 1,
    });

    let nextCursor: string | undefined;
    if (messages.length > limit) {
      nextCursor = messages[limit].id;
      messages.pop();
    }

    messages.reverse();

    jsonValidated(res, MessageListResponseSchema, 200, {
      messages,
      nextCursor,
    });
  }),
);

// POST /conversations/:id/messages — send a message
router.post(
  '/conversations/:id/messages',
  requireWallet,
  messageRateLimiter,
  validateParams(ConversationIdParamSchema),
  validateBody(SendMessageSchema),
  validateResponse(MessageResponseSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id } = req.params;
    const { content } = req.body as z.infer<typeof SendMessageSchema>;

    const participantCheck = await checkParticipant(id, walletAddress);
    if (!participantCheck) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You do not have access to this conversation',
      );
      return;
    }
    const { otherParty } = participantCheck;

    // Reject if the other participant has blocked this sender.
    const block = await prisma.blockedUser.findUnique({
      where: {
        conversationId_blockerAddress_blockedAddress: {
          conversationId: id,
          blockerAddress: otherParty.toLowerCase(),
          blockedAddress: walletAddress.toLowerCase(),
        },
      },
    });
    if (block) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You have been blocked in this conversation',
      );
      return;
    }

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        senderAddress: walletAddress,
        content,
      },
    });

    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    broadcastTo(otherParty, 'message.received', message);

    jsonValidated(res, MessageResponseSchema, 201, message);
  }),
);

// PATCH /conversations/:id/messages/:messageId — edit message
router.patch(
  '/conversations/:id/messages/:messageId',
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
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id, messageId } = req.params;
    const { content } = req.body as z.infer<typeof EditMessageSchema>;

    const participantCheck = await checkParticipant(id, walletAddress);
    if (!participantCheck) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You do not have access to this conversation',
      );
      return;
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      problemDetail(
        res,
        req,
        404,
        'Message Not Found',
        `No message with id ${messageId}`,
      );
      return;
    }

    if (message.senderAddress !== walletAddress) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You can only edit your own messages',
      );
      return;
    }

    if (message.deletedAt) {
      problemDetail(res, req, 409, 'Conflict', 'Cannot edit a deleted message');
      return;
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content },
    });

    broadcastTo(participantCheck.otherParty, 'message.edited', updated);

    jsonValidated(res, MessageResponseSchema, 200, updated);
  }),
);

// DELETE /conversations/:id/messages/:messageId — soft delete message
router.delete(
  '/conversations/:id/messages/:messageId',
  requireWallet,
  writeLimiter,
  validateParams(
    z.object({
      id: z.string().uuid(),
      messageId: z.string().uuid(),
    }),
  ),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id, messageId } = req.params;

    const participantCheck = await checkParticipant(id, walletAddress);
    if (!participantCheck) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You do not have access to this conversation',
      );
      return;
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      problemDetail(
        res,
        req,
        404,
        'Message Not Found',
        `No message with id ${messageId}`,
      );
      return;
    }

    if (message.senderAddress !== walletAddress) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You can only delete your own messages',
      );
      return;
    }

    if (message.deletedAt) {
      problemDetail(res, req, 409, 'Conflict', 'Message is already deleted');
      return;
    }

    await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    broadcastTo(participantCheck.otherParty, 'message.deleted', {
      id: messageId,
      conversationId: id,
    });

    res.status(204).send();
  }),
);

// POST /conversations/:id/read — mark conversation as read
router.post(
  '/conversations/:id/read',
  requireWallet,
  validateParams(ConversationIdParamSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id } = req.params;

    const participantCheck = await checkParticipant(id, walletAddress);
    if (!participantCheck) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You do not have access to this conversation',
      );
      return;
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    jsonValidated(res, ConversationResponseSchema, 200, conversation);
  }),
);

// POST /conversations/:id/block — block the other participant from messaging you
router.post(
  '/conversations/:id/block',
  requireWallet,
  writeLimiter,
  validateParams(ConversationIdParamSchema),
  validateBody(BlockUserSchema),
  validateResponse(BlockedUserResponseSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id } = req.params;
    const { blockedAddress } = req.body as z.infer<typeof BlockUserSchema>;

    const participantCheck = await checkParticipant(id, walletAddress);
    if (!participantCheck) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You do not have access to this conversation',
      );
      return;
    }

    const blockerAddress = walletAddress.toLowerCase();
    const blocked = await prisma.blockedUser.upsert({
      where: {
        conversationId_blockerAddress_blockedAddress: {
          conversationId: id,
          blockerAddress,
          blockedAddress: blockedAddress.toLowerCase(),
        },
      },
      update: {},
      create: {
        conversationId: id,
        blockerAddress,
        blockedAddress: blockedAddress.toLowerCase(),
      },
    });

    broadcastTo(blocked.blockedAddress, 'conversation.blocked', {
      conversationId: id,
    });

    jsonValidated(res, BlockedUserResponseSchema, 201, blocked);
  }),
);

// POST /conversations/:id/messages/:messageId/report — report a message
router.post(
  '/conversations/:id/messages/:messageId/report',
  requireWallet,
  writeLimiter,
  validateParams(
    z.object({
      id: z.string().uuid(),
      messageId: z.string().uuid(),
    }),
  ),
  validateBody(ReportMessageSchema),
  validateResponse(MessageReportResponseSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    const walletAddress = req.walletAddress!;
    const { id, messageId } = req.params;
    const { reason } = req.body as z.infer<typeof ReportMessageSchema>;

    const participantCheck = await checkParticipant(id, walletAddress);
    if (!participantCheck) {
      problemDetail(
        res,
        req,
        403,
        'Forbidden',
        'You do not have access to this conversation',
      );
      return;
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      problemDetail(
        res,
        req,
        404,
        'Message Not Found',
        `No message with id ${messageId}`,
      );
      return;
    }

    const report = await prisma.messageReport.create({
      data: {
        messageId,
        reporterAddress: walletAddress.toLowerCase(),
        reason,
      },
    });

    jsonValidated(res, MessageReportResponseSchema, 201, report);
  }),
);

export default router;
