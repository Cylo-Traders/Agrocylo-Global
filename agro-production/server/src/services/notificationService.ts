import { prisma } from '../db/client.js';

export interface NotificationRecord {
  id: string;
  walletAddress: string;
  message: string;
  orderId: string | null;
  campaignId: string | null;
  type: string;
  isRead: boolean;
  createdAt: Date;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
}

export async function createNotification(
  walletAddress: string,
  message: string,
  type: string,
  orderId?: string,
  campaignId?: string,
): Promise<NotificationRecord> {
  const notification = await prisma.notification.create({
    data: {
      walletAddress,
      message,
      orderId: orderId || null,
      campaignId: campaignId || null,
      type,
      isRead: false,
    },
  });

  return notification as NotificationRecord;
}

export async function listNotifications(
  walletAddress: string,
  options: ListNotificationsOptions = {},
): Promise<NotificationRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const notifications = await prisma.notification.findMany({
    where: {
      walletAddress,
      ...(options.unreadOnly && { isRead: false }),
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  });

  return notifications as NotificationRecord[];
}

export async function markAsRead(notificationId: string): Promise<void> {
  await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });
}

export async function markAllAsRead(walletAddress: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { walletAddress, isRead: false },
    data: { isRead: true },
  });
}

export async function getNotificationPreferences(
  walletAddress: string,
): Promise<Record<string, boolean>> {
  const pref = await prisma.notificationPreference.findUnique({
    where: { walletAddress },
  });

  return pref?.preferences as Record<string, boolean> || {
    campaign_updates: true,
    order_updates: true,
    milestone_events: true,
    dispute_alerts: true,
  };
}

export async function updateNotificationPreferences(
  walletAddress: string,
  preferences: Record<string, boolean>,
): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { walletAddress },
    create: { walletAddress, preferences },
    update: { preferences },
  });
}
