export const DEFAULT_EXPIRY_HOURS = 96;

export function getOrderExpirySeconds(order: {
  createdAt?: number;
  timestamp?: number;
  deliveryDeadline?: number | string | null;
}): number {
  if (order.deliveryDeadline != null && order.deliveryDeadline !== "") {
    const parsed =
      typeof order.deliveryDeadline === "number"
        ? order.deliveryDeadline
        : /^\d+$/.test(order.deliveryDeadline)
          ? Number(order.deliveryDeadline)
          : Math.floor(new Date(order.deliveryDeadline).getTime() / 1000);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed > 1e12 ? Math.floor(parsed / 1000) : parsed;
    }
  }
  const base = order.timestamp ?? order.createdAt ?? 0;
  return base + DEFAULT_EXPIRY_HOURS * 3600;
}
