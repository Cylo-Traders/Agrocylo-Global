/**
 * Issue #1257 route-level coverage. The tests mock the Prisma client
 * and the WebSocket broadcast helper so the tests run under the unit
 * suite (no PG, no WS server) while still pinning the full request
 * contract: list shape, join idempotency, concurrency-safe join
 * through the unique-index-violation path, authorization on the join
 * route, and the versioned WebSocket emit.
 */

import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const {
  mockFindMany,
  mockFindUnique,
  mockUpdate,
  mockParticipantCreate,
  mockTransaction,
  mockBroadcast,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockParticipantCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockBroadcast: vi.fn(),
}));

vi.mock('../middleware/walletAuth.js', () => ({
  requireWallet: ((req, _res, next) => {
    const wallet = req.header('x-wallet-address');
    if (!wallet) {
      return next(new Error('wallet required'));
    }
    (req as express.Request & { walletAddress?: string }).walletAddress = wallet;
    next();
  }) satisfies RequestHandler,
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    groupOrder: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
    groupOrderParticipant: {
      create: mockParticipantCreate,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock('../services/wsServer.js', () => ({
  broadcast: mockBroadcast,
}));

// `writeLimiter` and `validateResponse` are real; they are safe to run
// against the unit app because they do not reach out of process.

import groupOrderRoutes from './groupOrders.js';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const GROUP_ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(groupOrderRoutes);
  // Re-raise wallet-required to a 401 so the test can assert on status.
  app.use(((err, _req, res, _next) => {
    if (err?.message === 'wallet required') {
      res.status(401).json({ error: 'wallet required' });
      return;
    }
    res.status(500).json({ error: String(err?.message ?? err) });
  }) satisfies express.ErrorRequestHandler);
  return app;
}

describe('GET /group-orders (#1257)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns OPEN group orders newest-first with a bounded page size', async () => {
    const now = new Date().toISOString();
    mockFindMany.mockResolvedValue([
      {
        id: GROUP_ORDER_ID,
        productName: 'Tomatoes',
        pricePerUnit: '1000',
        targetQuantity: 10,
        currentQuantity: 3,
        expiresAt: now,
        status: 'OPEN',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const res = await request(makeApp()).get('/group-orders');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  });

  it('returns an empty array when nothing is open', async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await request(makeApp()).get('/group-orders');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('does not require a wallet', async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await request(makeApp()).get('/group-orders'); // no header
    expect(res.status).toBe(200);
  });
});

describe('POST /group-orders/:id/join (#1257)', () => {
  const now = new Date();
  const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const openOrder = {
    id: GROUP_ORDER_ID,
    productName: 'Tomatoes',
    pricePerUnit: '1000',
    targetQuantity: 10,
    currentQuantity: 3,
    expiresAt: future,
    status: 'OPEN',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unauthenticated join with 401', async () => {
    const res = await request(makeApp()).post(
      `/group-orders/${GROUP_ORDER_ID}/join`,
    );
    expect(res.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID id before touching the database', async () => {
    const res = await request(makeApp())
      .post('/group-orders/not-a-uuid/join')
      .set('x-wallet-address', WALLET);
    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('adds the wallet, advances currentQuantity, and emits group_order.updated', async () => {
    const updated = { ...openOrder, currentQuantity: 4 };
    mockTransaction.mockImplementation(async (cb: unknown) => {
      // Simulate the tx: findUnique -> participant.create -> update
      const txMock = {
        groupOrder: {
          findUnique: vi.fn().mockResolvedValue(openOrder),
          update: vi.fn().mockResolvedValue(updated),
        },
        groupOrderParticipant: { create: vi.fn().mockResolvedValue({}) },
      };
      return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
    });

    const res = await request(makeApp())
      .post(`/group-orders/${GROUP_ORDER_ID}/join`)
      .set('x-wallet-address', WALLET);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: GROUP_ORDER_ID,
      currentQuantity: 4,
      joined: true,
    });
    expect(mockBroadcast).toHaveBeenCalledWith('group_order.updated', {
      orderId: GROUP_ORDER_ID,
      currentQuantity: 4,
    });
  });

  it('marks the order COMPLETED when the target is reached', async () => {
    const nearlyFull = { ...openOrder, currentQuantity: 9 };
    const completed = { ...openOrder, currentQuantity: 10, status: 'COMPLETED' };
    mockTransaction.mockImplementation(async (cb: unknown) => {
      const update = vi.fn().mockResolvedValue(completed);
      const txMock = {
        groupOrder: {
          findUnique: vi.fn().mockResolvedValue(nearlyFull),
          update,
        },
        groupOrderParticipant: { create: vi.fn().mockResolvedValue({}) },
      };
      const result = await (cb as (tx: typeof txMock) => Promise<unknown>)(
        txMock,
      );
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentQuantity: 10,
            status: 'COMPLETED',
          }),
        }),
      );
      return result;
    });

    const res = await request(makeApp())
      .post(`/group-orders/${GROUP_ORDER_ID}/join`)
      .set('x-wallet-address', WALLET);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
  });

  it('returns 404 when the order does not exist', async () => {
    mockTransaction.mockImplementation(async (cb: unknown) => {
      const txMock = {
        groupOrder: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
        groupOrderParticipant: { create: vi.fn() },
      };
      return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
    });
    const res = await request(makeApp())
      .post(`/group-orders/${GROUP_ORDER_ID}/join`)
      .set('x-wallet-address', WALLET);
    expect(res.status).toBe(404);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('returns 409 when the order is no longer open', async () => {
    const closed = { ...openOrder, status: 'COMPLETED' };
    mockTransaction.mockImplementation(async (cb: unknown) => {
      const txMock = {
        groupOrder: {
          findUnique: vi.fn().mockResolvedValue(closed),
          update: vi.fn(),
        },
        groupOrderParticipant: { create: vi.fn() },
      };
      return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
    });
    const res = await request(makeApp())
      .post(`/group-orders/${GROUP_ORDER_ID}/join`)
      .set('x-wallet-address', WALLET);
    expect(res.status).toBe(409);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('is idempotent on a duplicate join (P2002) — returns joined:false with the current quantity', async () => {
    // The transaction raises a unique violation; the route catches it
    // and looks up the current state via findUnique at the outer scope.
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    mockTransaction.mockImplementation(async (cb: unknown) => {
      const txMock = {
        groupOrder: {
          findUnique: vi.fn().mockResolvedValue(openOrder),
          update: vi.fn().mockResolvedValue(openOrder),
        },
        groupOrderParticipant: {
          create: vi.fn().mockRejectedValue(uniqueViolation),
        },
      };
      return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
    });
    mockFindUnique.mockResolvedValue(openOrder);

    const res = await request(makeApp())
      .post(`/group-orders/${GROUP_ORDER_ID}/join`)
      .set('x-wallet-address', WALLET);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: GROUP_ORDER_ID,
      currentQuantity: 3,
      joined: false,
    });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});
