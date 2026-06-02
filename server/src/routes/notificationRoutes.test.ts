import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../app.js';

vi.mock('../services/notificationService.js', () => ({
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

vi.mock('../services/notificationPreferenceService.js', () => ({
  getNotificationPreferences: vi.fn(),
  upsertNotificationPreferences: vi.fn(),
  notificationPrefsSchema: {
    safeParse: (body: unknown) => ({ success: true, data: body }),
  },
}));

import * as notificationService from '../services/notificationService.js';
import * as notificationPreferenceService from '../services/notificationPreferenceService.js';

describe('Notification routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /notifications returns notification items for an authenticated wallet', async () => {
    vi.mocked(notificationService.listNotifications).mockResolvedValue([
      {
        id: 'n1',
        walletAddress: '0x1111111111111111111111111111111111111111',
        message: 'Order funded',
        orderId: '101',
        type: 'created',
        isRead: false,
        createdAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get('/notifications?unread_only=true&limit=10')
      .set('x-wallet-address', '0x1111111111111111111111111111111111111111');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(notificationService.listNotifications).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      { unreadOnly: true, limit: 10 },
    );
  });

  it('GET /notifications/preferences returns stored preferences', async () => {
    vi.mocked(notificationPreferenceService.getNotificationPreferences).mockResolvedValue({
      types: {
        orders: true,
        disputes: true,
        priceAlerts: false,
        system: true,
        demandSignals: false,
      },
      delivery: { toast: true, email: false, push: false },
      sound: true,
      quietHoursEnabled: false,
      quietStart: '22:00',
      quietEnd: '08:00',
    });

    const res = await request(app)
      .get('/notifications/preferences')
      .set('x-wallet-address', '0x1111111111111111111111111111111111111111');

    expect(res.status).toBe(200);
    expect(res.body.preferences.types.priceAlerts).toBe(false);
  });

  it('PUT /notifications/preferences updates preferences', async () => {
    const payload = {
      types: {
        orders: false,
        disputes: true,
        priceAlerts: true,
        system: true,
        demandSignals: false,
      },
      delivery: { toast: true, email: true, push: false },
      sound: false,
      quietHoursEnabled: true,
      quietStart: '21:00',
      quietEnd: '07:00',
    };

    vi.mocked(notificationPreferenceService.upsertNotificationPreferences).mockResolvedValue(
      payload,
    );

    const res = await request(app)
      .put('/notifications/preferences')
      .set('x-wallet-address', '0x1111111111111111111111111111111111111111')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.preferences.delivery.email).toBe(true);
    expect(notificationPreferenceService.upsertNotificationPreferences).toHaveBeenCalled();
  });

  it('PATCH /notifications/:id/read marks a notification as read', async () => {
    vi.mocked(notificationService.markNotificationsRead).mockResolvedValue({ count: 1 });

    const res = await request(app)
      .patch('/notifications/n1/read')
      .set('x-wallet-address', '0x1111111111111111111111111111111111111111');

    expect(res.status).toBe(204);
    expect(notificationService.markNotificationsRead).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      ['n1'],
    );
  });
});
