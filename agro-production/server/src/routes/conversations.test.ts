import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../db/client.js';
import request from 'supertest';
import express from 'express';
import conversationRoutes from './conversations.js';
import { verifySession } from '../services/walletAuthService.js';

vi.mock('../services/walletAuthService.js');
vi.mock('../db/client.js');

const app = express();
app.use(express.json());
app.use('/api/v1', conversationRoutes);

const mockToken = 'valid-session-token';
const mockWalletA = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const mockWalletB = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('POST /api/v1/conversations/:id/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifySession as any).mockResolvedValue({ walletAddress: mockWalletA, sessionToken: mockToken });
  });

  it('should reject message when sender is blocked', async () => {
    const conversationId = 'conv-123';

    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: conversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: 'campaign-123',
    });

    (prisma.blockedUser.findUnique as any).mockResolvedValue({
      id: 'block-123',
      conversationId,
      blockerAddress: mockWalletB.toLowerCase(),
      blockedAddress: mockWalletA.toLowerCase(),
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('x-session-token', mockToken)
      .send({ content: 'Test message' });

    expect(response.status).toBe(403);
    expect(response.body.title).toBe('Forbidden');
  });

  it('should reject message with rate limit exceeded', async () => {
    const conversationId = 'conv-123';

    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: conversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: 'campaign-123',
    });

    (prisma.blockedUser.findUnique as any).mockResolvedValue(null);

    // Send max requests to trigger rate limit
    for (let i = 0; i < 30; i++) {
      await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('x-session-token', mockToken)
        .send({ content: `Message ${i}` });
    }

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('x-session-token', mockToken)
      .send({ content: 'Over limit' });

    expect(response.status).toBe(429);
  });

  it('should reject message from non-participant', async () => {
    const conversationId = 'conv-123';

    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: conversationId,
      investorAddress: 'GCCC...',
      farmerAddress: 'GDDD...',
      campaignId: 'campaign-123',
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('x-session-token', mockToken)
      .send({ content: 'Test message' });

    expect(response.status).toBe(403);
    expect(response.body.title).toBe('Forbidden');
  });

  it('should reject oversized message content', async () => {
    const oversizedContent = 'x'.repeat(5001);

    const response = await request(app)
      .post('/api/v1/conversations/conv-123/messages')
      .set('x-session-token', mockToken)
      .send({ content: oversizedContent });

    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/conversations/:id/block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifySession as any).mockResolvedValue({ walletAddress: mockWalletA, sessionToken: mockToken });
  });

  it('should block a user in a conversation', async () => {
    const conversationId = 'conv-123';

    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: conversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: 'campaign-123',
    });

    (prisma.blockedUser.upsert as any).mockResolvedValue({
      id: 'block-123',
      conversationId,
      blockerAddress: mockWalletA.toLowerCase(),
      blockedAddress: mockWalletB.toLowerCase(),
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/block`)
      .set('x-session-token', mockToken)
      .send({ blockedAddress: mockWalletB });

    expect(response.status).toBe(201);
    expect(response.body.blockerAddress).toBe(mockWalletA.toLowerCase());
  });

  it('should reject block attempt from non-participant', async () => {
    const conversationId = 'conv-123';

    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: conversationId,
      investorAddress: 'GCCC...',
      farmerAddress: 'GDDD...',
      campaignId: 'campaign-123',
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/block`)
      .set('x-session-token', mockToken)
      .send({ blockedAddress: mockWalletB });

    expect(response.status).toBe(403);
  });
});

describe('POST /api/v1/conversations/:id/messages/:messageId/report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifySession as any).mockResolvedValue({ walletAddress: mockWalletA, sessionToken: mockToken });
  });

  it('should report a message', async () => {
    const conversationId = 'conv-123';
    const messageId = 'msg-123';

    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: conversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: 'campaign-123',
    });

    (prisma.message.findUnique as any).mockResolvedValue({
      id: messageId,
      conversationId,
      senderAddress: mockWalletB.toLowerCase(),
      content: 'Offensive content',
      createdAt: new Date(),
    });

    (prisma.messageReport.create as any).mockResolvedValue({
      id: 'report-123',
      messageId,
      reporterAddress: mockWalletA.toLowerCase(),
      reason: 'Abusive language',
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/${messageId}/report`)
      .set('x-session-token', mockToken)
      .send({ reason: 'Abusive language' });

    expect(response.status).toBe(201);
    expect(response.body.reason).toBe('Abusive language');
  });

  it('should reject report from non-participant', async () => {
    const conversationId = 'conv-123';
    const messageId = 'msg-123';

    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: conversationId,
      investorAddress: 'GCCC...',
      farmerAddress: 'GDDD...',
      campaignId: 'campaign-123',
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/${messageId}/report`)
      .set('x-session-token', mockToken)
      .send({ reason: 'Abusive language' });

    expect(response.status).toBe(403);
  });
});
