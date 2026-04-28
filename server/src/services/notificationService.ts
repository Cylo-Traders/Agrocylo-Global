import { prisma } from "../config/database.js";
import { ApiError } from "../http/errors.js";
import logger from "../config/logger.js";
import { NotificationEventType } from "../enums/notificationEventType.js";
import { buildNotificationMessage } from "../utils/notificationTemplates.js";
import { wsManager } from "./wsManager.js";

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

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit) return 20;
  return Math.min(Math.max(Math.trunc(limit), 1), 50);
}

function walletCandidates(walletAddress: string): string[] {
  return Array.from(new Set([walletAddress, walletAddress.toLowerCase(), walletAddress.toUpperCase()]));
}

/**
 * Maps a contract action to the list of notifications that should be sent.
 * - "created"   → OrderCreated (buyer) + FundsLocked (farmer)
 * - "delivered" → no notification (internal state change)
 * - "confirmed" → DeliveryConfirmed (farmer)
 * - "refunded"  → RefundIssued (buyer)
 */
const actionToNotifications: Record<string, (p: EscrowEventPayload) => MappedNotification[]> = {
  created: ({ buyerAddress, farmerAddress }) => [
    ...(buyerAddress ? [{ walletAddress: buyerAddress, type: NotificationEventType.ORDER_CREATED }] : []),
    ...(farmerAddress ? [{ walletAddress: farmerAddress, type: NotificationEventType.FUNDS_LOCKED }] : []),
  ],
  confirmed: ({ farmerAddress }) =>
    farmerAddress ? [{ walletAddress: farmerAddress, type: NotificationEventType.DELIVERY_CONFIRMED }] : [],
  refunded: ({ buyerAddress }) =>
    buyerAddress ? [{ walletAddress: buyerAddress, type: NotificationEventType.REFUND_ISSUED }] : [],
};

export async function listNotifications(
  walletAddress: string,
  options: ListNotificationsOptions = {},
): Promise<NotificationRecord[]> {
  return prisma.notification.findMany({
    where: {
      walletAddress: { in: walletCandidates(walletAddress) },
      ...(options.unreadOnly ?? true ? { isRead: false } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: clampLimit(options.limit),
  });
}

export async function markNotificationsRead(
  walletAddress: string,
  ids: string[],
): Promise<{ count: number }> {
  if (ids.length === 0) return { count: 0 };

  const notifications = await prisma.notification.findMany({
    where: { id: { in: ids } },
    select: { id: true, walletAddress: true },
  });

  if (notifications.length !== ids.length) {
    throw new ApiError(404, "Not Found", "One or more notifications were not found");
  }

  const walletMatches = walletCandidates(walletAddress);
  if (notifications.some((n) => !walletMatches.includes(n.walletAddress))) {
    throw new ApiError(403, "Forbidden", "You cannot modify these notifications");
  }

  const result = await prisma.notification.updateMany({
    where: { id: { in: ids } },
    data: { isRead: true },
  });

  return { count: result.count };
}

export class NotificationService {
  static async notify(payload: NotificationPayload): Promise<void> {
    try {
      const message = buildNotificationMessage(payload.type, {
        orderId: payload.orderId,
        amount: payload.amount,
        token: payload.token,
      });

      const record = await prisma.notification.create({
        data: {
          walletAddress: payload.walletAddress,
          message,
          orderId: payload.orderId,
          type: payload.type,
          isRead: false,
        },
      });

      // Push real-time notification to the wallet owner via WebSocket
      wsManager.broadcastTo(payload.walletAddress, "notification:new", {
        id: record.id,
        type: payload.type,
        message,
        orderId: payload.orderId,
      });
    } catch (error) {
      logger.error("Failed to create notification", error);
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
        }),
      ),
    );
  }

  /** Generic order-event notification (used by ingestion pipeline). */
  static async notifyOrderEvent(event: string, data: any): Promise<void> {
    logger.info(`[NotificationService] Emitting event: ${event}`);
    wsManager.broadcast(`order:${event}`, data);
  }
}
