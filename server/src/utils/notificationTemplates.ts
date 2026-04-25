import { NotificationEventType } from "../enums/notificationEventType.js";

type NotificationTemplateInput = {
  orderId: string;
  amount?: string;
  token?: string;
};

const templateByType: Record<NotificationEventType, (input: NotificationTemplateInput) => string> = {
  [NotificationEventType.NEW_INVESTMENT]: ({ orderId, amount, token }) =>
    `New investment recorded for order #${orderId}${amount && token ? `: ${amount} ${token}` : ""}.`,
  [NotificationEventType.CAMPAIGN_FUNDED]: ({ orderId }) =>
    `Campaign funded for order #${orderId}.`,
  [NotificationEventType.HARVEST_COMPLETED]: ({ orderId }) =>
    `Harvest completed for order #${orderId}.`,
  [NotificationEventType.ORDER_RECEIVED]: ({ orderId, amount, token }) =>
    `Order received #${orderId}${amount && token ? `: ${amount} ${token}` : ""}.`,
};

export function buildNotificationMessage(
  type: NotificationEventType,
  input: NotificationTemplateInput,
): string {
  return templateByType[type](input);
}

