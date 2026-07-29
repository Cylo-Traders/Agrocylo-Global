import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../app.js';

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
    req.walletAddress = req.headers['x-wallet-address'] || 'G1111111111111111111111111111111111111111111111111111111';
    next();
  },
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
