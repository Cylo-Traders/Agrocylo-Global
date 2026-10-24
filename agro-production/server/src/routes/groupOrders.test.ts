import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createRateLimitMock,
  createWalletAuthMock,
} from '../test/helpers/middlewareMocks.js';

vi.mock('../db/client.js', () => {
  const prismaMock: Record<string, any> = {
    groupOrder: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    groupOrderParticipant: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(prismaMock)),
  };
  return {
    prisma: prismaMock,
    connectDB: vi.fn(),
  };
});

vi.mock('../services/wsServer.js', () => ({
  broadcast: vi.fn(),
  broadcastTo: vi.fn(),
  getWsClientCount: vi.fn(() => 0),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
  drainWebSocketServer: vi.fn(),
}));

vi.mock('../middleware/walletAuth.js', () => createWalletAuthMock());
vi.mock('../middleware/rateLimit.js', () => createRateLimitMock());

import app from '../app.js';
import { prisma } from '../db/client.js';
import { broadcast } from '../services/wsServer.js';

const BUYER_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BUYER_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const GROUP_ORDER_ID = '11111111-1111-4111-8111-111111111111';
const FUTURE_ISO = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const basePool = {
  id: GROUP_ORDER_ID,
  productId: '22222222-2222-4222-8222-222222222222',
  productName: 'Bulk Organic Fertilizer (50kg)',
  currentQuantity: 4,
  targetQuantity: 10,
  pricePerUnit: 25,
  expiresAt: new Date(FUTURE_ISO),
  status: 'open' as const,
  createdAt: new Date('2026-04-20T08:00:00.000Z'),
  updatedAt: new Date('2026-04-20T08:00:00.000Z'),
};

describe('Group Orders API (#1257)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/group-orders', () => {
    it('returns the list of active and historical group orders', async () => {
      (prisma.groupOrder.findMany as any).mockResolvedValue([basePool]);

      const res = await request(app).get('/api/v1/group-orders').expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: GROUP_ORDER_ID,
        productName: 'Bulk Organic Fertilizer (50kg)',
        currentQuantity: 4,
        targetQuantity: 10,
        pricePerUnit: 25,
        status: 'open',
      });
    });

    it('returns an empty array when no group orders exist', async () => {
      (prisma.groupOrder.findMany as any).mockResolvedValue([]);

      const res = await request(app).get('/api/v1/group-orders').expect(200);
      expect(res.body).toEqual([]);
    });

    it('computes effective expired status when expiresAt has passed', async () => {
      (prisma.groupOrder.findMany as any).mockResolvedValue([
        {
          ...basePool,
          expiresAt: new Date(PAST_ISO),
          status: 'open',
        },
      ]);

      const res = await request(app).get('/api/v1/group-orders').expect(200);
      expect(res.body[0].status).toBe('expired');
    });
  });

  describe('POST /api/v1/group-orders/:id/join', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(app)
        .post(`/api/v1/group-orders/${GROUP_ORDER_ID}/join`)
        .send({ quantity: 1 })
        .expect(401);
    });

    it('returns 404 when the group order does not exist', async () => {
      (prisma.groupOrder.findUnique as any).mockResolvedValue(null);

      await request(app)
        .post(`/api/v1/group-orders/${GROUP_ORDER_ID}/join`)
        .set('x-wallet-address', BUYER_A)
        .send({ quantity: 1 })
        .expect(404);
    });

    it('joins an open pool, increments quantity, and broadcasts group_order.updated', async () => {
      (prisma.groupOrder.findUnique as any).mockResolvedValue(basePool);
      (prisma.groupOrderParticipant.findUnique as any).mockResolvedValue(null);
      (prisma.groupOrderParticipant.create as any).mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333',
        groupOrderId: GROUP_ORDER_ID,
        walletAddress: BUYER_A,
        quantity: 2,
      });
      (prisma.groupOrder.update as any).mockResolvedValue({
        ...basePool,
        currentQuantity: 6,
        status: 'open',
      });

      const res = await request(app)
        .post(`/api/v1/group-orders/${GROUP_ORDER_ID}/join`)
        .set('x-wallet-address', BUYER_A)
        .send({ quantity: 2 })
        .expect(200);

      expect(res.body).toMatchObject({
        id: GROUP_ORDER_ID,
        currentQuantity: 6,
        targetQuantity: 10,
        status: 'open',
        joined: true,
        idempotentReplay: false,
      });

      expect(broadcast).toHaveBeenCalledWith('group_order.updated', {
        orderId: GROUP_ORDER_ID,
        currentQuantity: 6,
        targetQuantity: 10,
        status: 'open',
      });
    });

    it('returns an idempotent 200 without double-incrementing or re-broadcasting on duplicate join by the same wallet', async () => {
      (prisma.groupOrder.findUnique as any).mockResolvedValue({
        ...basePool,
        currentQuantity: 6,
      });
      (prisma.groupOrderParticipant.findUnique as any).mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333',
        groupOrderId: GROUP_ORDER_ID,
        walletAddress: BUYER_A,
        quantity: 2,
      });

      const res = await request(app)
        .post(`/api/v1/group-orders/${GROUP_ORDER_ID}/join`)
        .set('x-wallet-address', BUYER_A)
        .send({ quantity: 2 })
        .expect(200);

      expect(res.body).toMatchObject({
        id: GROUP_ORDER_ID,
        currentQuantity: 6,
        joined: true,
        idempotentReplay: true,
      });
      expect(prisma.groupOrderParticipant.create).not.toHaveBeenCalled();
      expect(prisma.groupOrder.update).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('handles concurrent duplicate joins (P2002 unique violation) safely as idempotent replay', async () => {
      (prisma.groupOrder.findUnique as any).mockResolvedValue({
        ...basePool,
        currentQuantity: 5,
      });
      (prisma.groupOrderParticipant.findUnique as any).mockResolvedValue(null);
      (prisma.groupOrderParticipant.create as any).mockRejectedValue({
        code: 'P2002',
      });

      const res = await request(app)
        .post(`/api/v1/group-orders/${GROUP_ORDER_ID}/join`)
        .set('x-wallet-address', BUYER_B)
        .send({ quantity: 1 })
        .expect(200);

      expect(res.body.joined).toBe(true);
      expect(res.body.idempotentReplay).toBe(true);
      expect(prisma.groupOrder.update).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('rejects joining an expired group order with 409', async () => {
      (prisma.groupOrder.findUnique as any).mockResolvedValue({
        ...basePool,
        expiresAt: new Date(PAST_ISO),
      });
      (prisma.groupOrderParticipant.findUnique as any).mockResolvedValue(null);

      await request(app)
        .post(`/api/v1/group-orders/${GROUP_ORDER_ID}/join`)
        .set('x-wallet-address', BUYER_B)
        .send({ quantity: 1 })
        .expect(409);
    });

    it('rejects joining a completed group order with 409', async () => {
      (prisma.groupOrder.findUnique as any).mockResolvedValue({
        ...basePool,
        currentQuantity: 10,
        status: 'completed',
      });
      (prisma.groupOrderParticipant.findUnique as any).mockResolvedValue(null);

      await request(app)
        .post(`/api/v1/group-orders/${GROUP_ORDER_ID}/join`)
        .set('x-wallet-address', BUYER_B)
        .send({ quantity: 1 })
        .expect(409);
    });
  });
});
