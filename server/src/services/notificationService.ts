import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(limit: string | undefined): number {
  if (!limit) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ApiError(400, 'Bad Request', 'limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function parseUnreadOnly(value: string | undefined): boolean {
  if (!value) return true;
  return value === 'true' || value === '1';
}

function walletCandidates(walletAddress: string): string[] {
  const values = new Set<string>([walletAddress]);
  values.add(walletAddress.toLowerCase());
  values.add(walletAddress.toUpperCase());
  return Array.from(values);
}

export async function listNotifications(
  walletAddress: string,
  params: { unreadOnly?: string; limit?: string } = {},
) {
  const unreadOnly = parseUnreadOnly(params.unreadOnly);
  const limit = parseLimit(params.limit);
  const walletMatches = walletCandidates(walletAddress);

  const items = await prisma.notification.findMany({
    where: {
      walletAddress: { in: walletMatches },
      ...(unreadOnly ? { isRead: false } : {}),
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  });

  return { items };
}

export async function markNotificationRead(walletAddress: string, notificationId: string) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification) {
    throw new ApiError(404, 'Not Found', 'Notification not found');
  }

  const walletMatches = walletCandidates(walletAddress);
  if (!walletMatches.includes(notification.walletAddress)) {
    throw new ApiError(403, 'Forbidden', 'You cannot modify this notification');
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });
}
