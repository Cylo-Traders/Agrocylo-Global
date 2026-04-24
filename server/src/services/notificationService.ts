import { prisma } from "../config/database.js";
import { ApiError } from "../http/errors.js";

export interface NotificationRecord {
  id: string;
  walletAddress: string;
  message: string;
  orderId: string | null;
  type: string;
  isRead: boolean;
  createdAt: Date;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit) {
    return 20;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 50);
}

function walletCandidates(walletAddress: string): string[] {
  const values = new Set<string>([walletAddress]);
  values.add(walletAddress.toLowerCase());
  values.add(walletAddress.toUpperCase());
  return Array.from(values);
}

export async function listNotifications(
  walletAddress: string,
  options: ListNotificationsOptions = {},
): Promise<NotificationRecord[]> {
  const unreadOnly = options.unreadOnly ?? true;
  const limit = clampLimit(options.limit);
  const walletMatches = walletCandidates(walletAddress);

  return prisma.notification.findMany({
    where: {
      walletAddress: {
        in: walletMatches,
      },
      ...(unreadOnly ? { isRead: false } : {}),
    },
    orderBy: {
      createdAt: "asc",
    },
    take: limit,
  });
}

export async function markNotificationsRead(
  walletAddress: string,
  ids: string[],
): Promise<{ count: number }> {
  if (ids.length === 0) {
    return { count: 0 };
  }

  const notifications = await prisma.notification.findMany({
    where: {
      id: {
        in: ids,
      },
    },
    select: {
      id: true,
      walletAddress: true,
    },
  });

  if (notifications.length !== ids.length) {
    throw new ApiError(404, "Not Found", "One or more notifications were not found");
  }

  const walletMatches = walletCandidates(walletAddress);
  const unauthorized = notifications.some(
    (notification) => !walletMatches.includes(notification.walletAddress),
  );

  if (unauthorized) {
    throw new ApiError(403, "Forbidden", "You cannot modify these notifications");
  }

  const result = await prisma.notification.updateMany({
    where: {
      id: {
        in: ids,
      },
    },
    data: {
      isRead: true,
    },
  });

  return { count: result.count };
}
