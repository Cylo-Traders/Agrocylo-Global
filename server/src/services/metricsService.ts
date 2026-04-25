import { prisma } from "../config/database.js";

function utcCalendarDayBounds(reference = new Date()): { start: Date; end: Date; day: string } {
  const start = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), 0, 0, 0, 0),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const day = start.toISOString().slice(0, 10);
  return { start, end, day };
}

function sumNumericAmounts(amounts: string[]): number {
  let sum = 0;
  for (const a of amounts) {
    const n = Number(a);
    if (!Number.isFinite(n)) continue;
    sum += n;
  }
  return Math.round(sum * 1e8) / 1e8;
}

const ACTIVE_USER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Platform metrics for dashboards / monitoring.
 *
 * - orders_per_day: orders whose createdAt falls on the current UTC calendar day.
 * - campaigns_created: product listings (Product rows) created that same UTC day (farmer “campaigns”).
 * - total_volume: sum of Order.amount values that parse as finite numbers (all time).
 * - active_users: distinct buyer or seller wallets with an order in the last 30 days.
 */
export async function getPlatformMetrics() {
  const { start, end, day } = utcCalendarDayBounds();
  const activeSince = new Date(Date.now() - ACTIVE_USER_WINDOW_MS);

  const [ordersPerDay, campaignsCreated, orderAmounts, recentOrders] = await Promise.all([
    prisma.order.count({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.product.count({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.order.findMany({ select: { amount: true } }),
    prisma.order.findMany({
      where: { createdAt: { gte: activeSince } },
      select: { buyerAddress: true, sellerAddress: true },
    }),
  ]);

  const totalVolume = sumNumericAmounts(orderAmounts.map((o) => o.amount));

  const wallets = new Set<string>();
  for (const o of recentOrders) {
    wallets.add(o.buyerAddress);
    wallets.add(o.sellerAddress);
  }

  return {
    generated_at: new Date().toISOString(),
    utc_calendar_day: day,
    orders_per_day: ordersPerDay,
    campaigns_created: campaignsCreated,
    total_volume: totalVolume,
    active_users: wallets.size,
  };
}
