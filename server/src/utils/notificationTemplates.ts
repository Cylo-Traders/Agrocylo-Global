import { NotificationEventType } from "../enums/notificationEventType.js";

type NotificationTemplateInput = {
  orderId?: string;
  amount?: string;
  token?: string;
  condition?: string;
  severity?: string;
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
  [NotificationEventType.ORDER_CANCELLED]: ({ orderId }) =>
    `Order #${orderId} cancelled. Funds have been returned to the buyer.`,
  [NotificationEventType.ORDER_DISPUTED]: ({ orderId }) =>
    `Dispute opened for order #${orderId}. Awaiting resolution.`,
  [NotificationEventType.DISPUTE_RESOLVED]: ({ orderId }) =>
    `Dispute resolved for order #${orderId}.`,
  [NotificationEventType.SPLIT_CREATED]: ({ orderId, amount, token }) =>
    `Split order #${orderId} created${amount && token ? ` for ${amount} ${token}` : ""}.`,
  [NotificationEventType.SPLIT_FUNDED]: ({ orderId }) =>
    `Split order #${orderId} fully funded.`,
  [NotificationEventType.SPLIT_DISPUTED]: ({ orderId }) =>
    `Split order #${orderId} disputed.`,
  [NotificationEventType.SPLIT_RESOLVED]: ({ orderId }) =>
    `Split order #${orderId} dispute resolved.`,
  [NotificationEventType.ORDER_RECEIVED]: ({ orderId, amount, token }) =>
    `Order received #${orderId}${amount && token ? `: ${amount} ${token}` : ""}.`,
  [NotificationEventType.NEW_INVESTMENT]: ({ orderId, amount, token }) =>
    `New investment recorded for order #${orderId}${amount && token ? `: ${amount} ${token}` : ""}.`,
  [NotificationEventType.CAMPAIGN_FUNDED]: ({ orderId }) =>
    `Campaign funded for order #${orderId}.`,
  [NotificationEventType.HARVEST_COMPLETED]: ({ orderId }) =>
    `Harvest completed for order #${orderId}.`,
  [NotificationEventType.GROUP_ORDER_PROGRESS]: ({ orderId, amount, token }) =>
    `Group order #${orderId} is progressing${amount && token ? `: ${amount} ${token}` : ""}.`,
  [NotificationEventType.GROUP_ORDER_FUNDED]: ({ orderId, amount, token }) =>
    `Group order #${orderId} reached its threshold${amount && token ? ` with ${amount} ${token}` : ""}.`,
  [NotificationEventType.GROUP_ORDER_EXPIRED]: ({ orderId }) =>
    `Group order #${orderId} expired before reaching its threshold.`,
  [NotificationEventType.WEATHER_ALERT]: ({ condition, severity }) =>
    `Weather ${severity}: ${condition}. Take necessary precautions.`,
};

export function buildNotificationMessage(
  type: NotificationEventType,
  input: NotificationTemplateInput,
): string {
  return templateByType[type](input);
}
