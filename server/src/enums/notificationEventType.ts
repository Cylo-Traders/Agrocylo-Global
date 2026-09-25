export enum NotificationEventType {
  // Order lifecycle
  ORDER_CREATED = "order_created",
  FUNDS_LOCKED = "funds_locked",
  DELIVERY_CONFIRMED = "delivery_confirmed",
  REFUND_ISSUED = "refund_issued",
  ORDER_CANCELLED = "order_cancelled",
  ORDER_DISPUTED = "order_disputed",
  DISPUTE_RESOLVED = "dispute_resolved",
  // Split orders
  SPLIT_CREATED = "split_created",
  SPLIT_FUNDED = "split_funded",
  SPLIT_DISPUTED = "split_disputed",
  SPLIT_RESOLVED = "split_resolved",
  // Legacy / extended
  ORDER_RECEIVED = "order_received",
  NEW_INVESTMENT = "new_investment",
  CAMPAIGN_FUNDED = "campaign_funded",
  HARVEST_COMPLETED = "harvest_completed",
  GROUP_ORDER_PROGRESS = "group_order_progress",
  GROUP_ORDER_FUNDED = "group_order_funded",
  GROUP_ORDER_EXPIRED = "group_order_expired",
  WEATHER_ALERT = "weather_alert",
}
