import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../app.js';

// The rate limiters use a Redis-backed store that fails closed. CI has no Redis
// service for the unit-test job, so substitute an in-memory store that mirrors
// the production increment/reset semantics. This keeps the 429 assertions
// deterministic without weakening the fail-closed production behaviour.
vi.mock('../middleware/rateLimitStore.js', () => {
  const windows = new Map<string, { count: number; resetTime: number }>();
  return {
    createRateLimitStore: () => ({
      init() {},
      async increment(key: string) {
        const now = Date.now();
        const existing = windows.get(key);
        if (!existing || existing.resetTime <= now) {
          const resetTime = now + 60_000;
          windows.set(key, { count: 1, resetTime });
          return { totalHits: 1, resetTime: new Date(resetTime) };
        }
        existing.count += 1;
        return { totalHits: existing.count, resetTime: new Date(existing.resetTime) };
      },
      async decrement(key: string) {
        const existing = windows.get(key);
        if (existing) existing.count -= 1;
      },
      async reset(key: string) {
        windows.delete(key);
      },
      async resetKey(key: string) {
        windows.delete(key);
      },
    }),
  };
});

vi.mock('../config/database.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    cart: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    cartItem: { findMany: vi.fn(), deleteMany: vi.fn() },
    order: { create: vi.fn() },
    orderMetadata: { create: vi.fn() },
  },
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../middleware/walletAuth.js', () => ({
  requireWallet: (req: any, _res: any, next: any) => {
    req.walletAddress =
      req.headers['x-wallet-address'] || 'G1111111111111111111111111111111111111111111111111111111';
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireAnyRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/cartService.js', () => ({
  checkout: vi.fn().mockResolvedValue({ id: 'order-1', status: 'PENDING' }),
  getActiveCart: vi.fn(),
  addItem: vi.fn(),
  updateItemQuantity: vi.fn(),
  removeItem: vi.fn(),
  clearCart: vi.fn(),
}));

vi.mock('../services/orderMetadataService.js', () => ({
  createOrderMetadata: vi.fn().mockResolvedValue({ id: 'meta-1' }),
  getOrderMetadata: vi.fn(),
}));

describe('Rate limiting for checkout and order metadata (Issue #642)', () => {
  beforeAll(() => {
    process.env['ENABLE_TEST_RATE_LIMIT'] = 'true';
  });

  afterAll(() => {
    delete process.env['ENABLE_TEST_RATE_LIMIT'];
  });

  it('rate limits POST /cart/checkout when limit is exceeded', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/cart/checkout')
        .set('x-wallet-address', 'G1111111111111111111111111111111111111111111111111111111');
    }
    const res = await request(app)
      .post('/cart/checkout')
      .set('x-wallet-address', 'G1111111111111111111111111111111111111111111111111111111');

    expect(res.status).toBe(429);
  });

  it('rate limits POST /orders/metadata when limit is exceeded', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/orders/metadata')
        .set('x-wallet-address', 'G2222222222222222222222222222222222222222222222222222222')
        .send({ order_id: `ord-${i}`, metadata_hash: 'hash' });
    }
    const res = await request(app)
      .post('/orders/metadata')
      .set('x-wallet-address', 'G2222222222222222222222222222222222222222222222222222222')
      .send({ order_id: 'ord-extra', metadata_hash: 'hash' });

    expect(res.status).toBe(429);
  });
});
