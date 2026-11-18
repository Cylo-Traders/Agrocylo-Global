import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("@/lib/apiClient", () => ({
  __esModule: true,
  default: { get: mockGet },
}));

import {
  fetchPriceIndex,
  priceIndexView,
  PRICE_INDEX_STALE_AFTER_MS,
  type PriceIndexResponse,
} from "@/services/priceIndexService";

const meta = (computedAt: string): PriceIndexResponse["meta"] => ({
  source: "marketplace",
  currency: "XLM",
  unit: "XLM per product token",
  sampleSemantics: "count of active marketplace product listings in the group",
  regionSource: "linked campaign farmer address prefix, or Global when unlinked",
  computedAt,
});

describe("price index service (#1258)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes the request through the shared API client with a cancel signal", async () => {
    const response = { data: [], meta: meta(new Date().toISOString()) };
    mockGet.mockResolvedValue(response);
    const controller = new AbortController();

    await expect(fetchPriceIndex({ signal: controller.signal })).resolves.toBe(response);
    expect(mockGet).toHaveBeenCalledWith("/analytics/price-index", {
      signal: controller.signal,
    });
  });

  it("derives distinct loading, error, empty, stale and ready states", () => {
    const now = Date.parse("2026-06-01T00:00:00.000Z");
    const response: PriceIndexResponse = {
      data: [{
        crop: "Maize",
        region: "Global",
        averagePrice: 4.5,
        sampleCount: 2,
        computedAt: new Date(now).toISOString(),
      }],
      meta: meta(new Date(now).toISOString()),
    };

    expect(priceIndexView({ loading: true, error: null, response: null }, now).status).toBe("loading");
    expect(priceIndexView({ loading: false, error: "offline", response: null }, now).status).toBe("error");
    expect(priceIndexView({ loading: false, error: null, response: null }, now).status).toBe("empty");
    expect(priceIndexView({ loading: false, error: null, response: { ...response, data: [] } }, now).status).toBe("empty");
    expect(priceIndexView({ loading: false, error: null, response }, now).status).toBe("ready");
    expect(priceIndexView({ loading: false, error: null, response }, now + PRICE_INDEX_STALE_AFTER_MS + 1).status).toBe("stale");
  });
});
