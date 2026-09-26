import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import logger from '../config/logger.js';
import { NotificationEventType } from '../enums/notificationEventType.js';
import { buildNotificationMessage } from '../utils/notificationTemplates.js';
import { wsManager } from './wsManager.js';

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
  page?: number;
  pageSize?: number;
}

export interface ListNotificationsResult {
  items: NotificationRecord[];
  total: number;
}

type NotificationPayload = {
  walletAddress: string;
  type: NotificationEventType;
  orderId?: string;
  amount?: string;
  token?: string;
  condition?: string;
  severity?: string;
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

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit) return 20;
  return Math.min(Math.max(Math.trunc(limit), 1), 50);
}

function clampPage(page?: number): number {
  if (!Number.isFinite(page) || !page) return 1;
  return Math.max(Math.trunc(page), 1);
}

function walletCandidates(walletAddress: string): string[] {
  return Array.from(
    new Set([walletAddress, walletAddress.toLowerCase(), walletAddress.toUpperCase()])
  );
}

/**
 * Maps a contract action to the list of notifications that should be sent.
 * - "created"   → ORDER_CREATED (buyer) + FUNDS_LOCKED (farmer)
 * - "delivered" → no notification (internal state change)
 * - "confirmed" → DELIVERY_CONFIRMED (farmer)
 * - "refunded"  → REFUND_ISSUED (buyer)
 */
const actionToNotifications: Record<string, (p: EscrowEventPayload) => MappedNotification[]> = {
  created: ({ buyerAddress, farmerAddress }) => [
    ...(buyerAddress
      ? [
          {
            walletAddress: buyerAddress,
            type: NotificationEventType.ORDER_CREATED,
          },
        ]
      : []),
    ...(farmerAddress
      ? [
          {
            walletAddress: farmerAddress,
            type: NotificationEventType.FUNDS_LOCKED,
          },
        ]
      : []),
  ],
  confirmed: ({ farmerAddress }) =>
    farmerAddress
      ? [
          {
            walletAddress: farmerAddress,
            type: NotificationEventType.DELIVERY_CONFIRMED,
          },
        ]
      : [],
  refunded: ({ buyerAddress }) =>
    buyerAddress
      ? [
          {
            walletAddress: buyerAddress,
            type: NotificationEventType.REFUND_ISSUED,
          },
        ]
      : [],
};

export async function listNotifications(
  walletAddress: string,
  options: ListNotificationsOptions = {}
): Promise<ListNotificationsResult> {
  const candidates = walletCandidates(walletAddress);
  const where = {
    walletAddress: { in: candidates },
    ...((options.unreadOnly ?? true) ? { isRead: false } : {}),
  };

  const page = clampPage(options.page);
  const pageSize = clampLimit(options.pageSize ?? options.limit);
  const skip = (page - 1) * pageSize;

  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
  ]);

  return { items, total };
}

export async function markNotificationsRead(
  walletAddress: string,
  ids: string[]
): Promise<{ count: number }> {
  if (ids.length === 0) return { count: 0 };

  const notifications = await prisma.notification.findMany({
    where: { id: { in: ids } },
    select: { id: true, walletAddress: true },
  });

  if (notifications.length !== ids.length) {
    throw new ApiError(404, 'Not Found', 'One or more notifications were not found');
  }

  const walletMatches = walletCandidates(walletAddress);
  if (
    notifications.some(
      (n: { id: string; walletAddress: string }) => !walletMatches.includes(n.walletAddress)
    )
  ) {
    throw new ApiError(403, 'Forbidden', 'You cannot modify these notifications');
  }

  const result = await prisma.notification.updateMany({
    where: { id: { in: ids } },
    data: { isRead: true },
  });

  return { count: result.count };
}

export async function deleteNotification(
  walletAddress: string,
  notificationId: string
): Promise<void> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { walletAddress: true },
  });
  if (!notification) {
    throw new ApiError(404, 'Not Found', 'Notification not found');
  }
  const candidates = walletCandidates(walletAddress);
  if (!candidates.includes(notification.walletAddress)) {
    throw new ApiError(403, 'Forbidden', 'You cannot delete this notification');
  }
  await prisma.notification.delete({ where: { id: notificationId } });
}

export async function deleteAllNotifications(walletAddress: string): Promise<{ count: number }> {
  const candidates = walletCandidates(walletAddress);
  const result = await prisma.notification.deleteMany({
    where: { walletAddress: { in: candidates } },
  });
  return { count: result.count };
}

export class NotificationService {
  /**
   * Persist a notification to the DB and push it to the wallet owner via WebSocket.
   */
  static async notify(payload: NotificationPayload): Promise<void> {
    try {
      const message = buildNotificationMessage(payload.type, {
        orderId: payload.orderId,
        amount: payload.amount,
        token: payload.token,
        condition: payload.condition,
        severity: payload.severity,
      });

      const record = await prisma.notification.create({
        data: {
          walletAddress: payload.walletAddress,
          message,
          orderId: payload.orderId ?? null,
          type: payload.type,
          isRead: false,
        },
      });

      wsManager.broadcastTo(payload.walletAddress, 'notification:new', {
        id: record.id,
        type: payload.type,
        message,
        orderId: payload.orderId ?? null,
      });
    } catch (error) {
      logger.error('Failed to create notification', error);
    }
  }

  static async notifyFromEscrowEvent(payload: EscrowEventPayload): Promise<void> {
    const mapper = actionToNotifications[payload.action];
    if (!mapper) return;

    await Promise.all(
      mapper(payload).map((n) =>
        NotificationService.notify({
          walletAddress: n.walletAddress,
          type: n.type,
          orderId: payload.orderId,
          amount: payload.amount,
          token: payload.token,
        })
      )
    );
  }

  /**
   * Broadcast a generic order event to all connected WebSocket clients.
   * Used by the ingestion pipeline for dispute/resolution events.
   */
  static async notifyOrderEvent(event: string, data: unknown): Promise<void> {
    logger.info(`[NotificationService] Emitting event: ${event}`);
    wsManager.broadcastAuthenticated(`order:${event}`, data);
  }
}
