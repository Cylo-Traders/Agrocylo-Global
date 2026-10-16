import { prisma } from '../config/database.js';

const UNITS = ['kg', 'bag', 'crate', 'piece', 'litre', 'dozen', 'bunch'] as const;
const CATEGORIES = ['Vegetables', 'Fruits', 'Grains', 'Tubers', 'Livestock', 'Other'] as const;
type Unit = (typeof UNITS)[number];

const MAX_ROWS = 1000;

type DemandRow = Awaited<ReturnType<typeof prisma.buyerDemand.findMany>>[number];

function toUnit(value: string | null): Unit {
  const v = value?.toLowerCase();
  return (UNITS as readonly string[]).includes(v ?? '') ? (v as Unit) : 'kg';
}

function qty(row: DemandRow): number {
  const n = Number.parseFloat(row.quantityWanted ?? '');
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function recentDemands(since?: Date): Promise<DemandRow[]> {
  return prisma.buyerDemand.findMany({
    where: since ? { createdAt: { gte: since } } : {},
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
  });
}

/** Map of lowercase wallet -> [lat, lng] for wallets that have a saved location. */
async function coordsByWallet(rows: DemandRow[]): Promise<Map<string, [number, number]>> {
  const wallets = [...new Set(rows.map((r) => r.buyerWallet))];
  const map = new Map<string, [number, number]>();
  if (wallets.length === 0) return map;
  const locations = await prisma.location.findMany({ where: { walletAddress: { in: wallets } } });
  for (const l of locations) map.set(l.walletAddress.toLowerCase(), [l.lat, l.lng]);
  return map;
}

export async function getDemandData() {
  const [rows, intents, heatMap, trend] = await Promise.all([
    recentDemands(),
    getBuyerIntents(),
    getHeatMap(),
    getTrend(30),
  ]);
  const total = rows.reduce((sum, r) => sum + qty(r), 0);
  const breakdown = Object.fromEntries(CATEGORIES.map((c) => [c, '0'])) as Record<(typeof CATEGORIES)[number], string>;
  // Demand rows carry no category, so all volume is reported under "Other".
  breakdown.Other = String(total);
  return {
    volume: { total_volume: String(total), unit: 'kg' as Unit, category_breakdown: breakdown },
    intents,
    heatMap,
    trend,
  };
}

export async function getBuyerIntents(limit = 50) {
  const rows = (await recentDemands()).slice(0, limit);
  const coords = await coordsByWallet(rows);
  const names = await prisma.profile.findMany({
    where: { walletAddress: { in: [...new Set(rows.map((r) => r.buyerWallet))] } },
    select: { walletAddress: true, name: true },
  });
  const nameByWallet = new Map(names.map((p) => [p.walletAddress.toLowerCase(), p.name]));
  return rows.map((r) => ({
    id: r.id,
    buyer_name: nameByWallet.get(r.buyerWallet.toLowerCase()) ?? 'Buyer',
    product_name: r.cropName,
    category: null,
    quantity: r.quantityWanted ?? '0',
    unit: toUnit(r.unit),
    location: {
      region: r.region ?? 'Unknown',
      coordinates: coords.get(r.buyerWallet.toLowerCase()) ?? ([0, 0] as [number, number]),
    },
    created_at: r.createdAt.toISOString(),
    ...(r.neededBy ? { timeline: `By ${r.neededBy.toISOString().slice(0, 10)}` } : {}),
    ...(r.maxPricePerUnit ? { budget_range: `Up to ${r.maxPricePerUnit} ${r.currency ?? ''}`.trim() } : {}),
  }));
}

/** Aggregates buyer demand by region; coordinates are the mean of the buyers' saved locations. */
export async function getHeatMap() {
  const rows = await recentDemands();
  const coords = await coordsByWallet(rows);
  const groups = new Map<string, { weight: number; points: [number, number][] }>();
  for (const r of rows) {
    if (!r.region) continue;
    const g = groups.get(r.region) ?? { weight: 0, points: [] };
    g.weight += qty(r) || 1;
    const c = coords.get(r.buyerWallet.toLowerCase());
    if (c) g.points.push(c);
    groups.set(r.region, g);
  }
  const located = [...groups.entries()].filter(([, g]) => g.points.length > 0);
  const max = Math.max(1, ...located.map(([, g]) => g.weight));
  return located.map(([label, g]) => ({
    coordinates: [
      g.points.reduce((s, p) => s + p[0], 0) / g.points.length,
      g.points.reduce((s, p) => s + p[1], 0) / g.points.length,
    ] as [number, number],
    intensity: g.weight / max,
    label,
  }));
}

export async function getTrend(days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await recentDemands(since);
  const byDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    byDay.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), 0);
  }
  for (const r of rows) {
    const day = r.createdAt.toISOString().slice(0, 10);
    if (byDay.has(day)) byDay.set(day, byDay.get(day)! + qty(r));
  }
  return [...byDay.entries()].map(([date, volume]) => ({ date, volume }));
}
