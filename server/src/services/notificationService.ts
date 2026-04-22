import { prisma } from "../config/database.js";
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

