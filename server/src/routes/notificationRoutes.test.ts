import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../app.js';

vi.mock('../services/notificationService.js', () => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}));

import * as notificationService from '../services/notificationService.js';

describe('Notification routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /notifications returns notification items for an authenticated wallet', async () => {
    vi.mocked(notificationService.listNotifications).mockResolvedValue({
      items: [
        {
          id: 'n1',
          walletAddress: '0x1111111111111111111111111111111111111111',
          message: 'Order funded',
          orderId: '101',
          type: 'created',
          isRead: false,
        },
      ],
    });

    const res = await request(app)
      .get('/notifications?unread_only=true&limit=10')
      .set('x-wallet-address', '0x1111111111111111111111111111111111111111');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(notificationService.listNotifications).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      { unreadOnly: 'true', limit: '10' },
    );
  });

  it('PATCH /notifications/:id/read marks a notification as read', async () => {
    vi.mocked(notificationService.markNotificationRead).mockResolvedValue(undefined);

    const res = await request(app)
      .patch('/notifications/n1/read')
      .set('x-wallet-address', '0x1111111111111111111111111111111111111111');

    expect(res.status).toBe(204);
    expect(notificationService.markNotificationRead).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      'n1',
    );
  });
});
