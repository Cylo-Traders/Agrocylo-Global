import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import notificationRoutes from './notifications.js';
import { prisma } from '../db/client.js';
import jwt from 'jsonwebtoken';

vi.mock('../config/index.js', () => ({
  config: { jwtSecret: 'test-secret-at-least-32-chars-long!!' },
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    authNonce: {
      findUnique: vi.fn(),
    },
  },
}));

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
const WALLET_OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WALLET_ATTACKER =
  'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

const app = express();
app.use(express.json());
app.use(notificationRoutes);
app.use('/api/v1', notificationRoutes);

function signToken(walletAddress: string): string {
  return jwt.sign({ walletAddress, role: 'USER' }, JWT_SECRET, {
    expiresIn: '15m',
  });
}

describe('PATCH /notifications/:id/read (Issue #1251)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a wallet to mark its own notification as read (204)', async () => {
    (prisma.notification.updateMany as any).mockResolvedValue({ count: 1 });

    const res = await request(app)
      .patch(`/notifications/${VALID_UUID}/read`)
      .set('Authorization', `Bearer ${signToken(WALLET_OWNER)}`);

    expect(res.status).toBe(204);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: VALID_UUID, walletAddress: WALLET_OWNER },
      data: { isRead: true },
    });
  });

  it("returns non-leaking 404 when attempting to mark another wallet's notification as read", async () => {
    (prisma.notification.updateMany as any).mockResolvedValue({ count: 0 });

    const res = await request(app)
      .patch(`/notifications/${VALID_UUID}/read`)
      .set('Authorization', `Bearer ${signToken(WALLET_ATTACKER)}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      status: 404,
      title: 'Not Found',
      detail: 'Notification not found',
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: VALID_UUID, walletAddress: WALLET_ATTACKER },
      data: { isRead: true },
    });
  });

  it('returns the exact same non-leaking 404 for a nonexistent notification ID', async () => {
    (prisma.notification.updateMany as any).mockResolvedValue({ count: 0 });

    const res = await request(app)
      .patch(`/notifications/${NONEXISTENT_UUID}/read`)
      .set('Authorization', `Bearer ${signToken(WALLET_OWNER)}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      status: 404,
      title: 'Not Found',
      detail: 'Notification not found',
    });
  });

  it('validates malformed notification IDs and returns 400 Bad Request instead of 500', async () => {
    const res = await request(app)
      .patch('/notifications/not-a-uuid/read')
      .set('Authorization', `Bearer ${signToken(WALLET_OWNER)}`);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      status: 400,
      title: 'Validation Failed',
    });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).patch(`/notifications/${VALID_UUID}/read`);

    expect(res.status).toBe(401);
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });
});
