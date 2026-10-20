import type { Order } from "@/types";
import api, { type ApiClient } from "./apiClient";

export interface FarmerOrderSummary {
  pendingDeliveries: Order[];
  completedOrders: Order[];
  pendingValue: bigint;
  completedRevenue: bigint;
}

export const DEFAULT_PRICE_INDEX_STALE_SECONDS = 3600;

export interface PriceIndexEntry {
  crop: string;
  region: string;
  averagePrice: number;
  currency: "XLM";
  unit: "XLM_PER_UNIT";
  sampleCount: number;
  sampleSemantics: "active_marketplace_listings";
  regionSource: "campaign_farmer_wallet_prefix";
  computedAt: string;
}

export interface PriceIndexMeta {
  currency: "XLM";
  unit: "XLM_PER_UNIT";
  priceScale: "stroops_1e7_to_xlm";
  sampleSemantics: "active_marketplace_listings";
  regionSource: "campaign_farmer_wallet_prefix";
  source: "marketplace_computed";
  computedAt: string;
  staleAfterSeconds: number;
}

export interface PriceIndexResponse {
  data: PriceIndexEntry[];
  meta: PriceIndexMeta;
}

export interface PriceIndexClientLike {
  get: ApiClient["get"];
}

/**
 * Fetches the regional crop price index through the shared API client (#1258)
 * so split-origin deployments (NEXT_PUBLIC_API_URL) use the configured backend,
 * timeout, retry, and error semantics.
 */
export async function fetchFarmerPriceIndex(options: {
  client?: PriceIndexClientLike;
  signal?: AbortSignal;
} = {}): Promise<PriceIndexResponse> {
  const client = options.client ?? api;
  const raw = await client.get<Partial<PriceIndexResponse>>("/analytics/price-index", {
    auth: false,
    signal: options.signal,
  });

  const fallbackComputedAt =
    raw?.meta?.computedAt ??
    raw?.data?.[0]?.computedAt ??
    new Date().toISOString();

  const entries: PriceIndexEntry[] = Array.isArray(raw?.data)
    ? raw.data
        .filter(
          (row): row is PriceIndexEntry =>
            Boolean(row) &&
            typeof row.crop === "string" &&
            typeof row.region === "string" &&
            typeof row.averagePrice === "number" &&
            Number.isFinite(row.averagePrice) &&
            typeof row.sampleCount === "number" &&
            row.sampleCount > 0,
        )
        .map((row) => ({
          crop: row.crop,
          region: row.region,
          averagePrice: row.averagePrice,
          currency: "XLM",
          unit: "XLM_PER_UNIT",
          sampleCount: row.sampleCount,
          sampleSemantics: "active_marketplace_listings",
          regionSource: "campaign_farmer_wallet_prefix",
          computedAt: row.computedAt || fallbackComputedAt,
        }))
    : [];

  const meta: PriceIndexMeta = {
    currency: "XLM",
    unit: "XLM_PER_UNIT",
    priceScale: "stroops_1e7_to_xlm",
    sampleSemantics: "active_marketplace_listings",
    regionSource: "campaign_farmer_wallet_prefix",
    source: "marketplace_computed",
    computedAt: fallbackComputedAt,
    staleAfterSeconds:
      typeof raw?.meta?.staleAfterSeconds === "number" &&
      raw.meta.staleAfterSeconds > 0
        ? raw.meta.staleAfterSeconds
        : DEFAULT_PRICE_INDEX_STALE_SECONDS,
  };

  return { data: entries, meta };
}

/**
 * Determines whether a computed price-index response has exceeded its staleness SLA.
 */
export function isPriceIndexStale(
  response: PriceIndexResponse | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!response || response.data.length === 0) return false;
  const computedAtStr = response.meta?.computedAt || response.data[0]?.computedAt;
  if (!computedAtStr) return false;
  const computedMs = Date.parse(computedAtStr);
  if (!Number.isFinite(computedMs)) return true;
  const staleAfterMs =
    (response.meta?.staleAfterSeconds ?? DEFAULT_PRICE_INDEX_STALE_SECONDS) * 1000;
  return nowMs - computedMs > staleAfterMs;
}

/**
 * Defence in depth for the farmer dashboard. The API already filters by the
 * campaign owner, but a client must never display a record whose included
 * campaign belongs to another wallet.
 */
export function filterOrdersForFarmer(orders: Order[], farmerAddress: string): Order[] {
  return orders.filter(
    (order) => order.campaign?.farmerAddress === farmerAddress,
  );
}

export function summarizeFarmerOrders(orders: Order[]): FarmerOrderSummary {
  const pendingDeliveries = orders.filter((order) => order.status === "PENDING");
  const completedOrders = orders.filter((order) => order.status === "CONFIRMED");

  return {
    pendingDeliveries,
    completedOrders,
    pendingValue: pendingDeliveries.reduce(
      (total, order) => total + BigInt(order.amount),
      0n,
    ),
    completedRevenue: completedOrders.reduce(
      (total, order) => total + BigInt(order.amount),
      0n,
    ),
  };
}
