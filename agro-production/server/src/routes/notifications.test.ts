import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMarkAsRead } = vi.hoisted(() => ({
  mockMarkAsRead: vi.fn(),
}));

vi.mock('../middleware/walletAuth.js', () => ({
  requireWallet: ((req, _res, next) => {
    (req as express.Request & { walletAddress?: string }).walletAddress =
      req.header('x-wallet-address');
    next();
  }) satisfies RequestHandler,
}));

vi.mock('../services/notificationService.js', () => ({
  listNotifications: vi.fn(),
  markAsRead: mockMarkAsRead,
  markAllAsRead: vi.fn(),
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

import notificationRoutes from './notifications.js';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const NOTIFICATION_ID = '550e8400-e29b-41d4-a716-446655440000';

const app = express();
app.use(express.json());
app.use(notificationRoutes);

describe('PATCH /notifications/:id/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the owning wallet to mark its notification read', async () => {
    mockMarkAsRead.mockResolvedValue(true);

    const response = await request(app)
      .patch(`/notifications/${NOTIFICATION_ID}/read`)
      .set('x-wallet-address', WALLET);

    expect(response.status).toBe(204);
    expect(mockMarkAsRead).toHaveBeenCalledWith(NOTIFICATION_ID, WALLET);
  });

  it.each(['foreign', 'nonexistent'])(
    'returns the same non-leaking 404 for a %s notification',
    async () => {
      mockMarkAsRead.mockResolvedValue(false);

      const response = await request(app)
        .patch(`/notifications/${NOTIFICATION_ID}/read`)
        .set('x-wallet-address', WALLET);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        type: 'https://agrocylo.io/errors/notification-not-found',
        title: 'Notification Not Found',
        status: 404,
        instance: `/notifications/${NOTIFICATION_ID}/read`,
      });
    },
  );

  it('rejects malformed notification IDs without calling the service', async () => {
    const response = await request(app)
      .patch('/notifications/not-a-uuid/read')
      .set('x-wallet-address', WALLET);

    expect(response.status).toBe(400);
    expect(response.body.title).toBe('Validation Failed');
    expect(mockMarkAsRead).not.toHaveBeenCalled();
  });
});