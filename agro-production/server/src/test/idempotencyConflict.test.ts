import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const { mockVerifySession } = vi.hoisted(() => ({
  mockVerifySession: vi.fn(),
}));

vi.mock('../services/walletAuthService.js', () => ({
  verifySession: mockVerifySession,
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    investment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    transaction: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $disconnect: vi.fn(),
  },
}));

import app from '../app.js';
import { prisma } from '../db/client.js';
import {
  configureIdempotencyStore,
  type IdempotencyStore,
} from '../middleware/idempotency.js';

const WALLET = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
const CAMPAIGN_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORDER_ID = '660e8400-e29b-41d4-a716-446655440001';
const INVESTMENT_ID = '770e8400-e29b-41d4-a716-446655440002';

function createFreshStore(): IdempotencyStore {
  const map = new Map<string, any>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => {
      map.set(k, v);
    },
    delete: async (k) => {
      map.delete(k);
    },
  };
}

describe('Idempotency body mismatch & CORS preflight (Issue #1440)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureIdempotencyStore(createFreshStore());
    mockVerifySession.mockResolvedValue({
      walletAddress: WALLET,
      sessionToken: 'valid-session',
    });
  });

  describe('CORS preflight for x-idempotency-key', () => {
    it('allows x-idempotency-key in OPTIONS preflight requests', async () => {
      const res = await request(app)
        .options('/api/v1/orders')
        .set('Origin', 'http://localhost:3001')
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'content-type,authorization,x-idempotency-key',
        );

      expect(res.status).toBe(204);
      const allowHeaders = (
        res.headers['access-control-allow-headers'] ?? ''
      ).toLowerCase();
      expect(allowHeaders).toContain('x-idempotency-key');
    });
  });

  describe('POST /api/v1/orders idempotency replay and conflict', () => {
    it('returns the cached 201 response when replayed with the same key and identical body', async () => {
      const now = new Date();
      (prisma.campaign.findUnique as any).mockResolvedValue({
        id: CAMPAIGN_ID,
        status: 'HARVESTED',
      });
      (prisma.user.upsert as any).mockResolvedValue({});
      (prisma.order.create as any).mockResolvedValue({
        id: ORDER_ID,
        onChainId: 'intent:1',
        campaignId: CAMPAIGN_ID,
        buyerAddress: WALLET,
        amount: '1000',
        status: 'PENDING',
        ledger: 0,
        txHash: null,
        createdAt: now,
        updatedAt: now,
      });
      (prisma.transaction.create as any).mockResolvedValue({});

      const payload = {
        campaignId: CAMPAIGN_ID,
        amount: '1000',
        transactionHash: 'a'.repeat(64),
      };

      const first = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', 'Bearer valid-session')
        .set('x-idempotency-key', 'order-key-1')
        .send(payload);

      expect(first.status).toBe(201);
      expect(prisma.order.create).toHaveBeenCalledTimes(1);

      const replay = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', 'Bearer valid-session')
        .set('x-idempotency-key', 'order-key-1')
        .send(payload);

      expect(replay.status).toBe(201);
      expect(replay.body.id).toBe(ORDER_ID);
      expect(prisma.order.create).toHaveBeenCalledTimes(1);
    });

    it('returns 409 Problem+JSON and does not mutate state when the same key is reused with a different body', async () => {
      const now = new Date();
      (prisma.campaign.findUnique as any).mockResolvedValue({
        id: CAMPAIGN_ID,
        status: 'HARVESTED',
      });
      (prisma.user.upsert as any).mockResolvedValue({});
      (prisma.order.create as any).mockResolvedValue({
        id: ORDER_ID,
        onChainId: 'intent:1',
        campaignId: CAMPAIGN_ID,
        buyerAddress: WALLET,
        amount: '1000',
        status: 'PENDING',
        ledger: 0,
        txHash: null,
        createdAt: now,
        updatedAt: now,
      });
      (prisma.transaction.create as any).mockResolvedValue({});

      const first = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', 'Bearer valid-session')
        .set('x-idempotency-key', 'order-key-conflict')
        .send({
          campaignId: CAMPAIGN_ID,
          amount: '1000',
          transactionHash: 'a'.repeat(64),
        });

      expect(first.status).toBe(201);
      expect(prisma.order.create).toHaveBeenCalledTimes(1);

      const mismatch = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', 'Bearer valid-session')
        .set('x-idempotency-key', 'order-key-conflict')
        .send({
          campaignId: CAMPAIGN_ID,
          amount: '2500',
          transactionHash: 'a'.repeat(64),
        });

      expect(mismatch.status).toBe(409);
      expect(mismatch.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(mismatch.body.title).toMatch(/idempotency key conflict/i);
      expect(prisma.order.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/v1/campaigns and POST /api/v1/campaigns/:id/invest idempotency conflict', () => {
    it('returns 409 Problem+JSON on POST /api/v1/campaigns when key is reused with different body', async () => {
      const now = new Date();
      const future = new Date(Date.now() + 86400_000).toISOString();
      (prisma.user.upsert as any).mockResolvedValue({});
      (prisma.campaign.create as any).mockResolvedValue({
        id: CAMPAIGN_ID,
        onChainId: 'intent:camp-1',
        farmerAddress: WALLET,
        tokenAddress: WALLET,
        targetAmount: '5000',
        totalRaised: '0',
        totalRevenue: '0',
        status: 'FUNDING',
        deadline: new Date(future),
        createdAt: now,
        updatedAt: now,
      });
      (prisma.transaction.create as any).mockResolvedValue({});

      const first = await request(app)
        .post('/api/v1/campaigns')
        .set('Authorization', 'Bearer valid-session')
        .set('x-idempotency-key', 'camp-key-1')
        .send({
          tokenAddress: WALLET,
          targetAmount: '5000',
          deadline: future,
          transactionHash: 'b'.repeat(64),
        });

      expect(first.status).toBe(201);
      expect(prisma.campaign.create).toHaveBeenCalledTimes(1);

      const mismatch = await request(app)
        .post('/api/v1/campaigns')
        .set('Authorization', 'Bearer valid-session')
        .set('x-idempotency-key', 'camp-key-1')
        .send({
          tokenAddress: WALLET,
          targetAmount: '9000',
          deadline: future,
          transactionHash: 'b'.repeat(64),
        });

      expect(mismatch.status).toBe(409);
      expect(mismatch.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(prisma.campaign.create).toHaveBeenCalledTimes(1);
    });

    it('returns 409 Problem+JSON on POST /api/v1/campaigns/:id/invest when key is reused with different amount', async () => {
      const now = new Date();
      (prisma.campaign.findUnique as any).mockResolvedValue({
        id: CAMPAIGN_ID,
        status: 'FUNDING',
      });
      (prisma.user.upsert as any).mockResolvedValue({});
      (prisma.investment.create as any).mockResolvedValue({
        id: INVESTMENT_ID,
        campaignId: CAMPAIGN_ID,
        investorAddress: WALLET,
        amount: '500',
        ledger: 0,
        txHash: null,
        createdAt: now,
      });
      (prisma.transaction.create as any).mockResolvedValue({});

      const first = await request(app)
        .post(`/api/v1/campaigns/${CAMPAIGN_ID}/invest`)
        .set('Authorization', 'Bearer valid-session')
        .set('x-idempotency-key', 'invest-key-1')
        .send({ amount: '500', transactionHash: 'c'.repeat(64) });

      expect(first.status).toBe(201);
      expect(prisma.investment.create).toHaveBeenCalledTimes(1);

      const mismatch = await request(app)
        .post(`/api/v1/campaigns/${CAMPAIGN_ID}/invest`)
        .set('Authorization', 'Bearer valid-session')
        .set('x-idempotency-key', 'invest-key-1')
        .send({ amount: '999', transactionHash: 'c'.repeat(64) });

      expect(mismatch.status).toBe(409);
      expect(mismatch.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(prisma.investment.create).toHaveBeenCalledTimes(1);
    });
  });
});
