/**
 * Regional price-index client contract (Issue #1258).
 *
 * The API base, error handling, timeout and retries are owned by the shared
 * `api` client. Prices are XLM per product token: the server aggregates
 * `priceTokens` (stroops, 1 XLM = 10_000_000 stroops) from active listings.
 * `sampleCount` is the number of those listings in the group — not confirmed
 * orders, trades or external benchmark observations. `region` is derived from
 * the linked campaign's farmer-address prefix, or "Global" when unlinked.
 */
import api from "../lib/apiClient";

export interface PriceIndexEntry {
  crop: string;
  region: string;
  averagePrice: number;
  sampleCount: number;
  computedAt: string;
}

export interface PriceIndexMeta {
  source: "marketplace";
  currency: "XLM";
  unit: "XLM per product token";
  sampleSemantics: string;
  regionSource: string;
  computedAt: string;
}

export interface PriceIndexResponse {
  data: PriceIndexEntry[];
  meta: PriceIndexMeta;
}

/** The index is recomputed hourly; beyond two cycles it is shown as stale. */
export const PRICE_INDEX_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export async function fetchPriceIndex(
  options: { signal?: AbortSignal } = {},
): Promise<PriceIndexResponse> {
  return api.get<PriceIndexResponse>("/analytics/price-index", {
    signal: options.signal,
  });
}

export type PriceIndexView =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "stale"; data: PriceIndexEntry[]; meta: PriceIndexMeta }
  | { status: "ready"; data: PriceIndexEntry[]; meta: PriceIndexMeta };

/** Pure state derivation so loading/empty/stale/error stay distinct. */
export interface PriceIndexFetchState {
  loading: boolean;
  error: string | null;
  response: PriceIndexResponse | null;
}

export function priceIndexView(
  state: PriceIndexFetchState,
  now = Date.now(),
): PriceIndexView {
  if (state.loading) return { status: "loading" };
  if (state.error) return { status: "error", message: state.error };
  if (!state.response || state.response.data.length === 0) return { status: "empty" };

  const computedAt = Date.parse(state.response.meta.computedAt);
  const stale = Number.isNaN(computedAt) || now - computedAt > PRICE_INDEX_STALE_AFTER_MS;
  return {
    status: stale ? "stale" : "ready",
    data: state.response.data,
    meta: state.response.meta,
  };
}
