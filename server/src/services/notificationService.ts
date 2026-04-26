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
import logger from "../config/logger.js";
import { NotificationEventType } from "../enums/notificationEventType.js";
import { buildNotificationMessage } from "../utils/notificationTemplates.js";

type NotificationPayload = {
  walletAddress: string;
  type: NotificationEventType;
  orderId: string;
  amount?: string;
  token?: string;
};

type EscrowEventPayload = {
  action: string;
  buyerAddress?: string;
  farmerAddress?: string;
  orderId: string;
  amount?: string;
  token?: string;
};

type MappedNotification = {
  walletAddress: string;
  type: NotificationEventType;
};

const actionToNotifications: Record<string, (payload: EscrowEventPayload) => MappedNotification[]> = {
  created: (payload) => [
    ...(payload.farmerAddress
      ? [{ walletAddress: payload.farmerAddress, type: NotificationEventType.ORDER_RECEIVED as const }]
      : []),
    ...(payload.farmerAddress
      ? [{ walletAddress: payload.farmerAddress, type: NotificationEventType.NEW_INVESTMENT as const }]
      : []),
  ],
  confirmed: (payload) =>
    payload.farmerAddress
      ? [{ walletAddress: payload.farmerAddress, type: NotificationEventType.CAMPAIGN_FUNDED }]
      : [],
  refunded: (payload) =>
    payload.buyerAddress
      ? [{ walletAddress: payload.buyerAddress, type: NotificationEventType.HARVEST_COMPLETED }]
      : [],
};

export class NotificationService {
  static async notify(payload: NotificationPayload) {
    try {
      return await prisma.notification.create({
        data: {
          walletAddress: payload.walletAddress,
          message: buildNotificationMessage(payload.type, {
            orderId: payload.orderId,
            amount: payload.amount,
            token: payload.token,
          }),
          orderId: payload.orderId,
          type: payload.type,
          isRead: false,
        },
      });
    } catch (error) {
      logger.error("Failed to create notification", error);
      return null;
    }
  }

  static async notifyFromEscrowEvent(payload: EscrowEventPayload) {
    const mapper = actionToNotifications[payload.action];
    if (!mapper) return;

    const notifications = mapper(payload);
    await Promise.all(
      notifications.map((notification) =>
        NotificationService.notify({
          walletAddress: notification.walletAddress,
          type: notification.type,
          orderId: payload.orderId,
          amount: payload.amount,
          token: payload.token,
        }),
      ),
    );
  }
}

import { SocketService } from "./socketService.js";
import logger from "../config/logger.js";

export class NotificationService {
  /**
   * Notify users about order-related events.
   * @param event The event type (e.g., 'dispute_opened', 'dispute_resolved')
   * @param data The payload for the notification
   */
  public static async notifyOrderEvent(event: string, data: any) {
    logger.info(`[NotificationService]: Sending notification for event: ${event}`);
    
    // Emit via WebSocket
    SocketService.emit(event, data);

    // Future extension: Add logic to send emails, push notifications, etc.
  }
}
