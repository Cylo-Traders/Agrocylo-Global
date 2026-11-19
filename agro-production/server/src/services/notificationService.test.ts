import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNotificationUpdateMany } = vi.hoisted(() => ({
  mockNotificationUpdateMany: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    notification: {
      updateMany: mockNotificationUpdateMany,
    },
  },
}));

import { markAsRead } from './notificationService.js';

const NOTIFICATION_ID = '550e8400-e29b-41d4-a716-446655440000';
const OWNER_WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('markAsRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks a notification read only when both ID and wallet match', async () => {
    mockNotificationUpdateMany.mockResolvedValue({ count: 1 });

    await expect(markAsRead(NOTIFICATION_ID, OWNER_WALLET)).resolves.toBe(true);
    expect(mockNotificationUpdateMany).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID, walletAddress: OWNER_WALLET },
      data: { isRead: true },
    });
  });

  it('returns false when the ID is missing or belongs to another wallet', async () => {
    mockNotificationUpdateMany.mockResolvedValue({ count: 0 });

    await expect(markAsRead(NOTIFICATION_ID, OWNER_WALLET)).resolves.toBe(false);
  });
});