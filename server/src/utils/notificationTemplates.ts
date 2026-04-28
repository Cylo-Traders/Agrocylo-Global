import { NotificationEventType } from "../enums/notificationEventType.js";

type NotificationTemplateInput = {
  orderId: string;
  amount?: string;
  token?: string;
};

const templateByType: Record<NotificationEventType, (input: NotificationTemplateInput) => string> = {
  [NotificationEventType.ORDER_CREATED]: ({ orderId, amount, token }) =>
    `Order #${orderId} created${amount && token ? ` for ${amount} ${token}` : ""}.`,
  [NotificationEventType.FUNDS_LOCKED]: ({ orderId, amount, token }) =>
    `Funds locked in escrow for order #${orderId}${amount && token ? `: ${amount} ${token}` : ""}.`,
  [NotificationEventType.DELIVERY_CONFIRMED]: ({ orderId }) =>
    `Delivery confirmed for order #${orderId}. Payment has been released to the farmer.`,
  [NotificationEventType.REFUND_ISSUED]: ({ orderId }) =>
    `Refund issued for order #${orderId}. Funds have been returned to the buyer.`,
  [NotificationEventType.ORDER_RECEIVED]: ({ orderId, amount, token }) =>
    `Order received #${orderId}${amount && token ? `: ${amount} ${token}` : ""}.`,
  [NotificationEventType.NEW_INVESTMENT]: ({ orderId, amount, token }) =>
    `New investment recorded for order #${orderId}${amount && token ? `: ${amount} ${token}` : ""}.`,
  [NotificationEventType.CAMPAIGN_FUNDED]: ({ orderId }) =>
    `Campaign funded for order #${orderId}.`,
  [NotificationEventType.HARVEST_COMPLETED]: ({ orderId }) =>
    `Harvest completed for order #${orderId}.`,
};

export function buildNotificationMessage(
  type: NotificationEventType,
  input: NotificationTemplateInput,
): string {
  return templateByType[type](input);
}
