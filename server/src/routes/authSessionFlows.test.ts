import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
const FARMER_WALLET = 'GFARMER111111111111111111111111111111111111111111111111111';
const BUYER_WALLET = 'GBUYER2222222222222222222222222222222222222222222222222222';
const OTHER_WALLET = 'GOTHER3333333333333333333333333333333333333333333333333333';

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
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), upsert: vi.fn() },
    profile: { findUnique: vi.fn(), upsert: vi.fn() },
    nonce: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    priceHistory: { findMany: vi.fn() },
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../services/wsManager.js', () => ({ wsManager: { broadcast: vi.fn() } }));
vi.mock('../middleware/rateLimiter.js', () => ({
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
  nonceWalletRateLimiter: (_req: any, _res: any, next: any) => next(),
  uploadRateLimiter: (_req: any, _res: any, next: any) => next(),
  sharedRedisClient: null,
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromPublicKey: vi.fn().mockReturnValue({
      verify: vi.fn().mockReturnValue(true),
    }),
  },
}));

const { prisma } = await import('../config/database.js');
const { default: authRoutes } = await import('./authRoutes.js');
const { default: productRoutes, apiErrorHandler: productErrorHandler } = await import('./productRoutes.js');
const { default: notificationRoutes, notificationErrorHandler } = await import('./notificationRoutes.js');

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
app.use(productRoutes);
app.use(notificationRoutes);
app.use(productErrorHandler);
app.use(notificationErrorHandler);

function makeToken(payload: Record<string, unknown>, secret = JWT_SECRET, expiresIn = '1h') {
  return jwt.sign(payload, secret, { expiresIn });
}

describe('Auth & Session Flows (Issue #1190)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Onboarding + Auth Flow', () => {
    it('POST /auth/nonce generates a nonce challenge for a valid wallet', async () => {
      const future = new Date(Date.now() + 300_000);
      (prisma.nonce.upsert as any).mockResolvedValue({
        walletAddress: FARMER_WALLET,
        nonce: 'crypto-nonce-1234',
        createdAt: new Date(),
        expiresAt: future,
      });

      const res = await request(app)
        .post('/auth/nonce')
        .send({ walletAddress: FARMER_WALLET })
        .expect(200);

      expect(res.body).toHaveProperty('nonce', 'crypto-nonce-1234');
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain(FARMER_WALLET);
    });

    it('POST /auth/verify verifies signature and issues access & refresh tokens', async () => {
      const now = new Date();
      const future = new Date(Date.now() + 300_000);
      const row = {
        walletAddress: FARMER_WALLET,
        nonce: 'crypto-nonce-1234',
        createdAt: now,
        expiresAt: future,
      };

      (prisma.nonce.findUnique as any).mockResolvedValue(row);
      (prisma.nonce.delete as any).mockResolvedValue(row);
      (prisma.user.findUnique as any).mockResolvedValue({ walletAddress: FARMER_WALLET, role: 'FARMER' });
      (prisma.profile.findUnique as any).mockResolvedValue({ walletAddress: FARMER_WALLET, role: 'farmer' });
      (prisma.refreshToken.create as any).mockResolvedValue({
        id: 'token-id-1',
        tokenHash: 'hashed-token',
        walletAddress: FARMER_WALLET,
        expiresAt: new Date(Date.now() + 604_800_000),
      });

      const { buildSignInMessage } = await import('../services/authService.js');
      const msg = buildSignInMessage(FARMER_WALLET, row.nonce, row.createdAt, row.expiresAt);

      const res = await request(app)
        .post('/auth/verify')
        .send({
          walletAddress: FARMER_WALLET,
          signature: 'valid-signature-base64',
          message: msg,
        })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');

      const decoded = jwt.verify(res.body.accessToken, JWT_SECRET) as any;
      expect(decoded.walletAddress).toBe(FARMER_WALLET);
      expect(decoded.role).toBe('farmer');
    });

    it('rejects cross-app SSO handoff tokens when used as regular session tokens with 401', async () => {
      const handoffToken = makeToken({
        walletAddress: FARMER_WALLET,
        aud: 'agrocylo-sso-handoff',
      });

      const res = await request(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${handoffToken}`)
        .expect(401);

      expect(res.body.error).toContain('not a session token');
    });

    it('rejects request with 403 when x-wallet-address header does not match JWT wallet', async () => {
      const token = makeToken({ walletAddress: FARMER_WALLET, role: 'farmer' });

      const res = await request(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .set('x-wallet-address', OTHER_WALLET)
        .expect(403);

      expect(res.body.error).toContain('Wallet header does not match session');
    });
  });

  describe('2. Product Creation with Auth Flow', () => {
    it('POST /products fails with 401 when no auth token is provided', async () => {
      const res = await request(app)
        .post('/products')
        .send({
          name: 'Sweet Potatoes',
          price_per_unit: '10',
          currency: 'USDC',
          unit: 'kg',
        })
        .expect(401);

      expect(res.body.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('POST /products fails with 403 when authenticated as a BUYER', async () => {
      const buyerToken = makeToken({ walletAddress: BUYER_WALLET, role: 'buyer' });
      (prisma.profile.findUnique as any).mockResolvedValue({ walletAddress: BUYER_WALLET, role: 'buyer' });

      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          name: 'Sweet Potatoes',
          price_per_unit: '10',
          currency: 'USDC',
          unit: 'kg',
        })
        .expect(403);

      expect(res.body.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('farmer or seller');
    });

    it('POST /products succeeds with 201 when authenticated as a FARMER', async () => {
      const farmerToken = makeToken({ walletAddress: FARMER_WALLET, role: 'farmer' });
      (prisma.profile.findUnique as any).mockResolvedValue({ walletAddress: FARMER_WALLET, role: 'farmer' });
      (prisma.product.create as any).mockResolvedValue({
        id: 'prod-new-1',
        farmerWallet: FARMER_WALLET.toLowerCase(),
        name: 'Organic Carrots',
        description: 'Fresh local carrots',
        category: 'Vegetables',
        pricePerUnit: { toString: () => '12.5' },
        currency: 'USDC',
        unit: 'kg',
        stockQuantity: null,
        location: 'Region-A',
        imageUrl: null,
        chainNetwork: 'stellar:pubnet',
        deliveryWindow: null,
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${farmerToken}`)
        .send({
          name: 'Organic Carrots',
          description: 'Fresh local carrots',
          category: 'Vegetables',
          price_per_unit: '12.5',
          currency: 'USDC',
          unit: 'kg',
          location: 'Region-A',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id', 'prod-new-1');
      expect(res.body).toHaveProperty('farmer_wallet', FARMER_WALLET.toLowerCase());
      expect(res.body).toHaveProperty('name', 'Organic Carrots');
    });

    it('PATCH /products/:id returns 403 when updating another farmer product', async () => {
      const otherFarmerToken = makeToken({ walletAddress: OTHER_WALLET, role: 'farmer' });
      (prisma.product.findUnique as any).mockResolvedValue({
        id: 'prod-1',
        farmerWallet: FARMER_WALLET.toLowerCase(),
        name: 'Tomato',
      });

      const res = await request(app)
        .patch('/products/prod-1')
        .set('Authorization', `Bearer ${otherFarmerToken}`)
        .send({ name: 'Hacked Tomato' })
        .expect(403);

      expect(res.body.status).toBe(403);
      expect(res.body.error).toContain('You do not own this product');
    });

    it('DELETE /products/:id soft-deletes product when requested by owner', async () => {
      const farmerToken = makeToken({ walletAddress: FARMER_WALLET, role: 'farmer' });
      (prisma.product.findUnique as any).mockResolvedValue({
        id: 'prod-1',
        farmerWallet: FARMER_WALLET.toLowerCase(),
        name: 'Tomato',
      });
      (prisma.profile.findUnique as any).mockResolvedValue({ walletAddress: FARMER_WALLET.toLowerCase(), role: 'farmer' });
      (prisma.product.update as any).mockResolvedValue({
        id: 'prod-1',
        farmerWallet: FARMER_WALLET.toLowerCase(),
        name: 'Tomato',
        description: null,
        category: 'Vegetables',
        pricePerUnit: { toString: () => '5' },
        currency: 'USDC',
        unit: 'kg',
        stockQuantity: null,
        location: null,
        imageUrl: null,
        chainNetwork: 'stellar:pubnet',
        deliveryWindow: null,
        isAvailable: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .delete('/products/prod-1')
        .set('Authorization', `Bearer ${farmerToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('is_available', false);
    });
  });

  describe('3. Notifications and Preferences Flow', () => {
    it('GET /notifications returns 401 without auth token', async () => {
      await request(app).get('/notifications').expect(401);
    });

    it('GET /notifications returns notifications for authenticated user', async () => {
      const token = makeToken({ walletAddress: FARMER_WALLET, role: 'farmer' });
      (prisma.notification.findMany as any).mockResolvedValue([
        {
          id: 'notif-1',
          walletAddress: FARMER_WALLET,
          type: 'ORDER_PLACED',
          title: 'New Order',
          message: 'An order was placed for your products',
          read: false,
          createdAt: new Date(),
        },
      ]);
      (prisma.notification.count as any).mockResolvedValue(1);

      const res = await request(app)
        .get('/notifications?unread_only=false')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('notifications');
      expect(res.body.notifications).toHaveLength(1);
      expect(res.body.notifications[0].title).toBe('New Order');
    });

    it('PATCH /notifications/:id/read marks notification as read', async () => {
      const token = makeToken({ walletAddress: FARMER_WALLET, role: 'farmer' });
      (prisma.notification.updateMany as any).mockResolvedValue({ count: 1 });

      await request(app)
        .patch('/notifications/notif-1/read')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    });

    it('GET /notifications/preferences returns stored user preferences', async () => {
      const token = makeToken({ walletAddress: FARMER_WALLET, role: 'farmer' });
      (prisma.notificationPreference.findUnique as any).mockResolvedValue({
        walletAddress: FARMER_WALLET,
        orderUpdates: true,
        marketing: false,
        systemAlerts: true,
      });

      const res = await request(app)
        .get('/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('preferences');
      expect(res.body.preferences.orderUpdates).toBe(true);
    });

    it('PUT /notifications/preferences updates user preferences', async () => {
      const token = makeToken({ walletAddress: FARMER_WALLET, role: 'farmer' });
      (prisma.notificationPreference.upsert as any).mockResolvedValue({
        walletAddress: FARMER_WALLET,
        orderUpdates: true,
        marketing: true,
        systemAlerts: true,
      });

      const res = await request(app)
        .put('/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({
          orderUpdates: true,
          marketing: true,
          systemAlerts: true,
        })
        .expect(200);

      expect(res.body.preferences.marketing).toBe(true);
    });
  });
});
