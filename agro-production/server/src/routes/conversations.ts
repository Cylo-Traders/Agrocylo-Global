import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { problemDetail } from '../middleware/errors.js';
import { prisma } from '../db/client.js';
import { verifySession } from '../services/walletAuthService.js';
import logger from '../config/logger.js';

const router = Router();

const CreateMessageSchema = z.object({
  content: z.string().min(1, 'Content is required').max(5000, 'Message too long'),
});

const GetConversationsQuerySchema = z.object({
  campaignId: z.string().optional(),
});

// GET /conversations - list conversations for authenticated user
router.get('/conversations', async (req: Request, res: Response) => {
  const sessionToken = req.headers['x-session-token'] as string | undefined;
  if (!sessionToken) {
    problemDetail(res, req, 401, 'Unauthorized', 'Session token required');
    return;
  }

  try {
    const session = await verifySession(sessionToken);
    const walletAddress = session.walletAddress.toLowerCase();

    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { investorAddress: { equals: walletAddress, mode: 'insensitive' } },
          { farmerAddress: { equals: walletAddress, mode: 'insensitive' } },
        ],
      },
      include: {
        campaign: {
          select: {
            id: true,
            onChainId: true,
            farmerAddress: true,
            status: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            content: true,
            senderAddress: true,
            createdAt: true,
            isRead: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    res.json(conversations);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid session')) {
      problemDetail(res, req, 401, 'Unauthorized', 'Invalid session token');
      return;
    }
    logger.error('Failed to fetch conversations', { error });
    problemDetail(res, req, 500, 'Internal Server Error');
  }
});

// GET /conversations/:id - get conversation with messages
router.get('/conversations/:id', async (req: Request, res: Response) => {
  const sessionToken = req.headers['x-session-token'] as string | undefined;
  if (!sessionToken) {
    problemDetail(res, req, 401, 'Unauthorized', 'Session token required');
    return;
  }

  try {
    const session = await verifySession(sessionToken);
    const walletAddress = session.walletAddress.toLowerCase();
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderAddress: true,
            content: true,
            isRead: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      problemDetail(res, req, 404, 'Not Found', 'Conversation not found');
      return;
    }

    const isParticipant =
      conversation.investorAddress.toLowerCase() === walletAddress ||
      conversation.farmerAddress.toLowerCase() === walletAddress;

    if (!isParticipant) {
      problemDetail(res, req, 403, 'Forbidden', 'Access denied');
      return;
    }

    res.json(conversation);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid session')) {
      problemDetail(res, req, 401, 'Unauthorized', 'Invalid session token');
      return;
    }
    logger.error('Failed to fetch conversation', { error });
    problemDetail(res, req, 500, 'Internal Server Error');
  }
});

// POST /conversations/:id/messages - send message
router.post('/conversations/:id/messages', validateBody(CreateMessageSchema), async (req: Request, res: Response) => {
  const sessionToken = req.headers['x-session-token'] as string | undefined;
  if (!sessionToken) {
    problemDetail(res, req, 401, 'Unauthorized', 'Session token required');
    return;
  }

  try {
    const session = await verifySession(sessionToken);
    const walletAddress = session.walletAddress.toLowerCase();
    const { id } = req.params;
    const { content } = req.body as { content: string };

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      problemDetail(res, req, 404, 'Not Found', 'Conversation not found');
      return;
    }

    const isParticipant =
      conversation.investorAddress.toLowerCase() === walletAddress ||
      conversation.farmerAddress.toLowerCase() === walletAddress;

    if (!isParticipant) {
      problemDetail(res, req, 403, 'Forbidden', 'Access denied');
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
      data: { lastMessageAt: new Date() },
    });

    res.status(201).json(message);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid session')) {
      problemDetail(res, req, 401, 'Unauthorized', 'Invalid session token');
      return;
    }
    logger.error('Failed to create message', { error });
    problemDetail(res, req, 500, 'Internal Server Error');
  }
});

// POST /conversations - create or get conversation
router.post('/conversations', validateBody(z.object({
  campaignId: z.string(),
  otherParticipant: z.string(),
})), async (req: Request, res: Response) => {
  const sessionToken = req.headers['x-session-token'] as string | undefined;
  if (!sessionToken) {
    problemDetail(res, req, 401, 'Unauthorized', 'Session token required');
    return;
  }

  try {
    const session = await verifySession(sessionToken);
    const walletAddress = session.walletAddress.toLowerCase();
    const { campaignId, otherParticipant } = req.body as { campaignId: string; otherParticipant: string };

    const conversation = await prisma.conversation.upsert({
      where: {
        campaignId_investorAddress_farmerAddress: {
          campaignId,
          investorAddress: walletAddress.toLowerCase() < otherParticipant.toLowerCase() ? walletAddress : otherParticipant,
          farmerAddress: walletAddress.toLowerCase() > otherParticipant.toLowerCase() ? walletAddress : otherParticipant,
        },
      },
      update: {},
      create: {
        campaignId,
        investorAddress: walletAddress.toLowerCase() < otherParticipant.toLowerCase() ? walletAddress : otherParticipant,
        farmerAddress: walletAddress.toLowerCase() > otherParticipant.toLowerCase() ? walletAddress : otherParticipant,
      },
    });

    res.status(201).json(conversation);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid session')) {
      problemDetail(res, req, 401, 'Unauthorized', 'Invalid session token');
      return;
    }
    logger.error('Failed to create/get conversation', { error });
    problemDetail(res, req, 500, 'Internal Server Error');
  }
});

export default router;
