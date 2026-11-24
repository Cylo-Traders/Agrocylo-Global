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

import {
  fetchFarmerAnalytics,
  farmerAnalyticsView,
  FARMER_ANALYTICS_WINDOWS,
  type FarmerAnalyticsResponse,
} from "@/services/farmerAnalyticsService";

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

describe("farmer analytics service (#1399)", () => {
  beforeEach(() => vi.clearAllMocks());

  const analyticsResponse = (): FarmerAnalyticsResponse => ({
    window: "30d",
    metrics: ["views", "cartAdditions", "completedSales"],
    listings: [
      {
        listingId: "listing-1",
        title: "Maize",
        views: 120,
        cartAdditions: 18,
        completedSales: 4,
      },
    ],
    meta: {
      farmerAddress: "GFARMER",
      windowStart: "2026-05-02T00:00:00.000Z",
      windowEnd: "2026-06-01T00:00:00.000Z",
      computedAt: "2026-06-01T00:00:00.000Z",
    },
  });

  it("documents the supported time windows", () => {
    expect(FARMER_ANALYTICS_WINDOWS).toEqual(["7d", "30d", "90d"]);
  });

  it("requests the authenticated farmer's analytics for the selected window", async () => {
    const response = analyticsResponse();
    mockGet.mockResolvedValue(response);
    const controller = new AbortController();

    await expect(
      fetchFarmerAnalytics({ window: "30d", signal: controller.signal }),
    ).resolves.toBe(response);
    expect(mockGet).toHaveBeenCalledWith("/analytics/farmer/listings", {
      params: { window: "30d" },
      signal: controller.signal,
    });
  });

  it("derives distinct loading, error, empty and ready states", () => {
    const response = analyticsResponse();

    expect(farmerAnalyticsView({ loading: true, error: null, response: null }).status).toBe("loading");
    expect(farmerAnalyticsView({ loading: false, error: "offline", response: null }).status).toBe("error");
    expect(farmerAnalyticsView({ loading: false, error: null, response: null }).status).toBe("empty");
    expect(
      farmerAnalyticsView({ loading: false, error: null, response: { ...response, listings: [] } }).status,
    ).toBe("empty");
    expect(farmerAnalyticsView({ loading: false, error: null, response }).status).toBe("ready");
  });
});
