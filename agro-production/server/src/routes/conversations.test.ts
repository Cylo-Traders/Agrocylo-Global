import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../db/client.js';
import request from 'supertest';
import express from 'express';
import conversationRoutes from './conversations.js';
import { verifySession } from '../services/walletAuthService.js';

vi.mock('../services/walletAuthService.js');
vi.mock('../db/client.js', () => ({
  prisma: {
    conversation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    message: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    blockedUser: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    messageReport: {
      create: vi.fn(),
    },
  },
  connectDB: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/v1', conversationRoutes);

const mockToken = 'valid-session-token';
const mockWalletA = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const mockWalletB = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const mockConversationId = '11111111-1111-4111-8111-111111111111';
const mockMessageId = '22222222-2222-4222-8222-222222222222';
const mockCampaignId = '33333333-3333-4333-8333-333333333333';

describe('POST /api/v1/conversations/:id/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifySession as any).mockResolvedValue({ walletAddress: mockWalletA, sessionToken: mockToken });
  });

  it('should reject message when sender is blocked', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: mockCampaignId,
    });

    (prisma.blockedUser.findUnique as any).mockResolvedValue({
      id: 'block-123',
      conversationId: mockConversationId,
      blockerAddress: mockWalletB.toLowerCase(),
      blockedAddress: mockWalletA.toLowerCase(),
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/messages`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ content: 'Test message' });

    expect(response.status).toBe(403);
    expect(response.body.title).toBe('Forbidden');
  });

  it('should reject message from non-participant', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      farmerAddress: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      campaignId: mockCampaignId,
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/messages`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ content: 'Test message' });

    expect(response.status).toBe(403);
    expect(response.body.title).toBe('Forbidden');
  });

  it('should accept message content at boundary max - 1 (3999 chars)', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: mockCampaignId,
    });
    (prisma.blockedUser.findUnique as any).mockResolvedValue(null);
    (prisma.message.create as any).mockResolvedValue({
      id: mockMessageId,
      conversationId: mockConversationId,
      senderAddress: mockWalletA,
      content: 'x'.repeat(3999),
      createdAt: new Date().toISOString(),
    });
    (prisma.conversation.update as any).mockResolvedValue({});

    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/messages`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ content: 'x'.repeat(3999) });

    expect(response.status).toBe(201);
    expect(response.body.content).toBe('x'.repeat(3999));
  });

  it('should accept message content at boundary max (4000 chars)', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: mockCampaignId,
    });
    (prisma.blockedUser.findUnique as any).mockResolvedValue(null);
    (prisma.message.create as any).mockResolvedValue({
      id: mockMessageId,
      conversationId: mockConversationId,
      senderAddress: mockWalletA,
      content: 'x'.repeat(4000),
      createdAt: new Date().toISOString(),
    });
    (prisma.conversation.update as any).mockResolvedValue({});

    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/messages`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ content: 'x'.repeat(4000) });

    expect(response.status).toBe(201);
    expect(response.body.content).toBe('x'.repeat(4000));
  });

  it('should reject message content at boundary max + 1 (4001 chars) with 400 validation error', async () => {
    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/messages`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ content: 'x'.repeat(4001) });

    expect(response.status).toBe(400);
    expect(response.body.title).toBe('Validation Failed');
  });

  // Runs last: exhausts the shared per-wallet message rate limiter, which
  // would otherwise mask the assertions in the tests above with 429s.
  it('should reject message with rate limit exceeded', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: mockCampaignId,
    });

    (prisma.blockedUser.findUnique as any).mockResolvedValue(null);

    // Send max requests to trigger rate limit
    for (let i = 0; i < 30; i++) {
      await request(app)
        .post(`/api/v1/conversations/${mockConversationId}/messages`)
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ content: `Message ${i}` });
    }

    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/messages`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ content: 'Over limit' });

    expect(response.status).toBe(429);
  });
});

describe('POST /api/v1/conversations/:id/block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifySession as any).mockResolvedValue({ walletAddress: mockWalletA, sessionToken: mockToken });
  });

  it('should block a user in a conversation', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: mockCampaignId,
    });

    (prisma.blockedUser.upsert as any).mockResolvedValue({
      id: 'block-123',
      conversationId: mockConversationId,
      blockerAddress: mockWalletA.toLowerCase(),
      blockedAddress: mockWalletB.toLowerCase(),
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/block`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ blockedAddress: mockWalletB });

    expect(response.status).toBe(201);
    expect(response.body.blockerAddress).toBe(mockWalletA.toLowerCase());
  });

  it('should reject block attempt from non-participant', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      farmerAddress: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      campaignId: mockCampaignId,
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/block`)
      .set('Authorization', `Bearer ${mockToken}`)
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
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: mockCampaignId,
    });

    (prisma.message.findUnique as any).mockResolvedValue({
      id: mockMessageId,
      conversationId: mockConversationId,
      senderAddress: mockWalletB.toLowerCase(),
      content: 'Offensive content',
      createdAt: new Date(),
    });

    (prisma.messageReport.create as any).mockResolvedValue({
      id: 'report-123',
      messageId: mockMessageId,
      reporterAddress: mockWalletA.toLowerCase(),
      reason: 'Abusive language',
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/messages/${mockMessageId}/report`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ reason: 'Abusive language' });

    expect(response.status).toBe(201);
    expect(response.body.reason).toBe('Abusive language');
  });

  it('should reject report from non-participant', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      farmerAddress: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      campaignId: mockCampaignId,
    });

    const response = await request(app)
      .post(`/api/v1/conversations/${mockConversationId}/messages/${mockMessageId}/report`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ reason: 'Abusive language' });

    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/v1/conversations/:id/messages/:messageId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifySession as any).mockResolvedValue({ walletAddress: mockWalletA, sessionToken: mockToken });
  });

  it('should accept message edit at boundary max - 1 (3999 chars)', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: mockCampaignId,
    });
    (prisma.message.findUnique as any).mockResolvedValue({
      id: mockMessageId,
      conversationId: mockConversationId,
      senderAddress: mockWalletA,
      content: 'Original message',
      deletedAt: null,
      createdAt: new Date().toISOString(),
    });
    (prisma.message.update as any).mockResolvedValue({
      id: mockMessageId,
      conversationId: mockConversationId,
      senderAddress: mockWalletA,
      content: 'x'.repeat(3999),
      createdAt: new Date().toISOString(),
    });

    const response = await request(app)
      .patch(`/api/v1/conversations/${mockConversationId}/messages/${mockMessageId}`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ content: 'x'.repeat(3999) });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe('x'.repeat(3999));
  });

  it('should accept message edit at boundary max (4000 chars)', async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: mockConversationId,
      investorAddress: mockWalletA.toLowerCase(),
      farmerAddress: mockWalletB.toLowerCase(),
      campaignId: mockCampaignId,
    });
    (prisma.message.findUnique as any).mockResolvedValue({
      id: mockMessageId,
      conversationId: mockConversationId,
      senderAddress: mockWalletA,
      content: 'Original message',
      deletedAt: null,
      createdAt: new Date().toISOString(),
    });
    (prisma.message.update as any).mockResolvedValue({
      id: mockMessageId,
      conversationId: mockConversationId,
      senderAddress: mockWalletA,
      content: 'x'.repeat(4000),
      createdAt: new Date().toISOString(),
    });

    const response = await request(app)
      .patch(`/api/v1/conversations/${mockConversationId}/messages/${mockMessageId}`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ content: 'x'.repeat(4000) });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe('x'.repeat(4000));
  });

  it('should reject message edit at boundary max + 1 (4001 chars) with 400 validation error', async () => {
    const response = await request(app)
      .patch(`/api/v1/conversations/${mockConversationId}/messages/${mockMessageId}`)
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ content: 'x'.repeat(4001) });

    expect(response.status).toBe(400);
    expect(response.body.title).toBe('Validation Failed');
  });
});
