import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../db/client.js';
import {
  createNotification,
  listNotifications,
  markAsRead,
  markAllAsRead,
} from './notificationService.js';

vi.mock('../db/client.js', () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe('notificationService.markAsRead', () => {
  const WALLET_OWNER =
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const WALLET_OTHER =
    'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const NOTIF_ID = '11111111-1111-4111-a111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates notification when walletAddress matches owner', async () => {
    (prisma.notification.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await markAsRead(NOTIF_ID, WALLET_OWNER);

    expect(result).toBe(true);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: NOTIF_ID, walletAddress: WALLET_OWNER },
      data: { isRead: true },
    });
  });

  it('does not update notification when walletAddress belongs to a different wallet', async () => {
    (prisma.notification.updateMany as any).mockResolvedValue({ count: 0 });

    const result = await markAsRead(NOTIF_ID, WALLET_OTHER);

    expect(result).toBe(false);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: NOTIF_ID, walletAddress: WALLET_OTHER },
      data: { isRead: true },
    });
  });

  it('returns false when notification ID does not exist', async () => {
    (prisma.notification.updateMany as any).mockResolvedValue({ count: 0 });

    const result = await markAsRead('non-existent-id', WALLET_OWNER);

    expect(result).toBe(false);
  });
});
