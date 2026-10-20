import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRICE_INDEX_STALE_SECONDS,
  fetchFarmerPriceIndex,
  filterOrdersForFarmer,
  isPriceIndexStale,
  summarizeFarmerOrders,
} from "@/lib/farmerDashboard";
import type { Order } from "@/types";

const FARMER = "GFARMER";

const orders: Order[] = [
  {
    id: "order-pending",
    onChainId: "1",
    campaignId: "campaign-a",
    buyerAddress: "GBUYER",
    amount: "15000000",
    status: "PENDING",
    ledger: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    campaign: { farmerAddress: FARMER, tokenAddress: "GTOKEN", onChainId: "1" },
  },
  {
    id: "order-confirmed",
    onChainId: "2",
    campaignId: "campaign-a",
    buyerAddress: "GBUYER2",
    amount: "25000000",
    status: "CONFIRMED",
    ledger: 2,
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    campaign: { farmerAddress: FARMER, tokenAddress: "GTOKEN", onChainId: "1" },
  },
  {
    id: "other-farmer",
    onChainId: "3",
    campaignId: "campaign-b",
    buyerAddress: "GBUYER3",
    amount: "99999999",
    status: "CONFIRMED",
    ledger: 3,
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    campaign: { farmerAddress: "GOTHER", tokenAddress: "GTOKEN", onChainId: "2" },
  },
];

describe("farmer dashboard order summary", () => {
  it("shows only orders on campaigns owned by the connected farmer", () => {
    expect(filterOrdersForFarmer(orders, FARMER).map((order) => order.id)).toEqual([
      "order-pending",
      "order-confirmed",
    ]);
  });

  it("separates outstanding fulfilment from confirmed revenue using integer totals", () => {
    const summary = summarizeFarmerOrders(filterOrdersForFarmer(orders, FARMER));
    expect(summary.pendingDeliveries).toHaveLength(1);
    expect(summary.completedOrders).toHaveLength(1);
    expect(summary.pendingValue).toBe(15_000_000n);
    expect(summary.completedRevenue).toBe(25_000_000n);
  });
});

describe("farmer price index client contract (#1258)", () => {
  it("routes requests through the shared API client at /analytics/price-index and parses populated entries", async () => {
    const computedAt = "2026-04-20T10:00:00.000Z";
    const mockGet = vi.fn().mockResolvedValue({
      data: [
        {
          crop: "Maize",
          region: "Region-GBCX",
          averagePrice: 30,
          currency: "XLM",
          unit: "XLM_PER_UNIT",
          sampleCount: 3,
          sampleSemantics: "active_marketplace_listings",
          regionSource: "campaign_farmer_wallet_prefix",
          computedAt,
        },
      ],
      meta: {
        currency: "XLM",
        unit: "XLM_PER_UNIT",
        priceScale: "stroops_1e7_to_xlm",
        sampleSemantics: "active_marketplace_listings",
        regionSource: "campaign_farmer_wallet_prefix",
        source: "marketplace_computed",
        computedAt,
        staleAfterSeconds: 3600,
      },
    });

    const res = await fetchFarmerPriceIndex({ client: { get: mockGet } });
    expect(mockGet).toHaveBeenCalledWith("/analytics/price-index", {
      auth: false,
      signal: undefined,
    });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      crop: "Maize",
      region: "Region-GBCX",
      averagePrice: 30,
      currency: "XLM",
      unit: "XLM_PER_UNIT",
      sampleCount: 3,
      sampleSemantics: "active_marketplace_listings",
      regionSource: "campaign_farmer_wallet_prefix",
    });
    expect(res.meta.source).toBe("marketplace_computed");
    expect(res.meta.staleAfterSeconds).toBe(DEFAULT_PRICE_INDEX_STALE_SECONDS);
  });

  it("returns an explicit empty dataset without fabricated benchmark rows when no listings exist", async () => {
    const computedAt = "2026-04-20T10:00:00.000Z";
    const mockGet = vi.fn().mockResolvedValue({
      data: [],
      meta: {
        currency: "XLM",
        unit: "XLM_PER_UNIT",
        priceScale: "stroops_1e7_to_xlm",
        sampleSemantics: "active_marketplace_listings",
        regionSource: "campaign_farmer_wallet_prefix",
        source: "marketplace_computed",
        computedAt,
        staleAfterSeconds: 3600,
      },
    });

    const res = await fetchFarmerPriceIndex({ client: { get: mockGet } });
    expect(res.data).toEqual([]);
    expect(isPriceIndexStale(res, Date.parse("2026-04-20T15:00:00.000Z"))).toBe(false);
  });

  it("flags computed price index data as stale once staleAfterSeconds has elapsed", async () => {
    const computedAt = "2026-04-20T10:00:00.000Z";
    const mockGet = vi.fn().mockResolvedValue({
      data: [
        {
          crop: "Coffee",
          region: "Region-GD7Y",
          averagePrice: 45.5,
          sampleCount: 2,
          computedAt,
        },
      ],
      meta: {
        computedAt,
        staleAfterSeconds: 1800,
      },
    });

    const res = await fetchFarmerPriceIndex({ client: { get: mockGet } });
    // 10 minutes after computedAt -> fresh
    expect(isPriceIndexStale(res, Date.parse("2026-04-20T10:10:00.000Z"))).toBe(false);
    // 45 minutes after computedAt -> stale (> 1800s)
    expect(isPriceIndexStale(res, Date.parse("2026-04-20T10:45:00.000Z"))).toBe(true);
  });

  it("propagates API client errors so the widget can render an explicit error alert", async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error("Request timed out"));
    await expect(
      fetchFarmerPriceIndex({ client: { get: mockGet } }),
    ).rejects.toThrow("Request timed out");
  });
});

