import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
const USER_WALLET = 'GUSER111111111111111111111111111111111111111111111111111';
const OTHER_WALLET = 'GOTHER2222222222222222222222222222222222222222222222222222';

vi.mock('ioredis', () => ({
  default: class {
    constructor() {
      throw new Error('redis disabled in tests');
    }
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    jwtSecret: JWT_SECRET,
    adminWallets: [],
    nodeEnv: 'test',
  },
}));

vi.mock('../config/database.js', () => ({
  prisma: {
    order: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../services/orderService.js', () => ({
  OrderService: {
    getAllForWallet: vi.fn(),
    getByOrderId: vi.fn(),
    getByBuyerAddress: vi.fn(),
    getByFarmerAddress: vi.fn(),
    getSellerStats: vi.fn(),
  },
}));

import { OrderService } from '../services/orderService.js';
const { default: orderRoutes, orderErrorHandler } = await import('./orderRoutes.js');
const { default: notificationRoutes, notificationErrorHandler } = await import('./notificationRoutes.js');
const { default: productImageRoutes, productImageErrorHandler } = await import('./productImageRoutes.js');
const { requestContext } = await import('../middleware/requestContext.js');

const app = express();
app.use(requestContext);
app.use(express.json());
app.use('/orders', orderRoutes);
app.use(notificationRoutes);
app.use(productImageRoutes);
app.use(orderErrorHandler);
app.use(notificationErrorHandler);
app.use(productImageErrorHandler);

function makeToken(payload: Record<string, unknown>, secret = JWT_SECRET) {
  return jwt.sign(payload, secret);
}

describe('Structured API Error Responses (Issue #1188)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Order API Error Responses', () => {
    it('returns structured 401 when Authorization header is missing', async () => {
      const res = await request(app)
        .get('/orders')
        .set('x-request-id', 'test-req-123')
        .expect(401);

      expect(res.body).toHaveProperty('status', 401);
      expect(res.body).toHaveProperty('code', 'UNAUTHORIZED');
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('requestId', 'test-req-123');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('returns structured 404 when order does not exist', async () => {
      const token = makeToken({ walletAddress: USER_WALLET });
      vi.mocked(OrderService.getByOrderId).mockResolvedValue(null);

      const res = await request(app)
        .get('/orders/nonexistent-order')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(res.body).toHaveProperty('status', 404);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
      expect(res.body.message).toContain('Order not found');
    });

    it('returns structured 403 when accessing an order belonging to another user', async () => {
      const token = makeToken({ walletAddress: USER_WALLET });
      vi.mocked(OrderService.getByOrderId).mockResolvedValue({
        id: 'order-1',
        buyerAddress: 'GDIFFERENTBUYER',
        sellerAddress: 'GDIFFERENTSELLER',
      } as any);

      const res = await request(app)
        .get('/orders/order-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body).toHaveProperty('status', 403);
      expect(res.body).toHaveProperty('code', 'FORBIDDEN');
      expect(res.body.message).toContain('Forbidden');
    });

    it('returns structured 500 without leaking internal database stack trace on service failure', async () => {
      const token = makeToken({ walletAddress: USER_WALLET });
      vi.mocked(OrderService.getAllForWallet).mockRejectedValue(
        new Error('PrismaClientKnownRequestError: relation "orders" does not exist at pg.execute'),
      );

      const res = await request(app)
        .get('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(500);

      expect(res.body).toHaveProperty('status', 500);
      expect(res.body).toHaveProperty('code', 'INTERNAL_SERVER_ERROR');
      expect(res.body.message).toBe('An unexpected error occurred. Please try again later.');
      // Must NOT leak database driver or table names
      expect(res.body.message).not.toContain('PrismaClientKnownRequestError');
      expect(res.body.message).not.toContain('pg.execute');
    });
  });

  describe('Product Image Upload Error Responses', () => {
    it('returns structured 400 when image field is missing', async () => {
      const token = makeToken({ walletAddress: USER_WALLET });

      const res = await request(app)
        .post('/products/prod-1/image')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(res.body).toHaveProperty('status', 400);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('Missing image field');
    });

    it('returns structured 415 when unsupported MIME type is uploaded', async () => {
      const token = makeToken({ walletAddress: USER_WALLET });

      const res = await request(app)
        .post('/products/prod-1/image')
        .set('Authorization', `Bearer ${token}`)
        .attach('image', Buffer.from('hello'), { filename: 'test.gif', contentType: 'image/gif' })
        .expect(415);

      expect(res.body).toHaveProperty('status', 415);
      expect(res.body).toHaveProperty('code', 'UNSUPPORTED_MIME_TYPE');
      expect(res.body.message).toContain('Unsupported Media Type');
    });
  });
});
