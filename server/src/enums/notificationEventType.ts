export enum NotificationEventType {
  // Order lifecycle
  ORDER_CREATED = "order_created",
  FUNDS_LOCKED = "funds_locked",
  DELIVERY_CONFIRMED = "delivery_confirmed",
  REFUND_ISSUED = "refund_issued",
  // Legacy / extended
  ORDER_RECEIVED = "order_received",
  NEW_INVESTMENT = "new_investment",
  CAMPAIGN_FUNDED = "campaign_funded",
  HARVEST_COMPLETED = "harvest_completed",
}
