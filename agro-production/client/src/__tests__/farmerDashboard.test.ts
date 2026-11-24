import { describe, expect, it } from "vitest";
import {
  filterOrdersForFarmer,
  summarizeFarmerOrders,
  ANALYTICS_WINDOWS,
  filterAnalyticsEventsByWindow,
  summarizeListingAnalytics,
} from "@/lib/farmerDashboard";
import type { Order, ListingAnalyticsEvent } from "@/types";

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

const NOW = new Date("2026-02-01T00:00:00.000Z");

const events: ListingAnalyticsEvent[] = [
  {
    id: "evt-view-recent",
    listingId: "listing-a",
    farmerAddress: FARMER,
    metric: "VIEW",
    occurredAt: "2026-01-30T00:00:00.000Z",
  },
  {
    id: "evt-cart-recent",
    listingId: "listing-a",
    farmerAddress: FARMER,
    metric: "CART_ADD",
    occurredAt: "2026-01-31T00:00:00.000Z",
  },
  {
    id: "evt-sale-recent",
    listingId: "listing-a",
    farmerAddress: FARMER,
    metric: "SALE",
    occurredAt: "2026-01-31T12:00:00.000Z",
  },
  {
    id: "evt-view-old",
    listingId: "listing-a",
    farmerAddress: FARMER,
    metric: "VIEW",
    occurredAt: "2025-11-01T00:00:00.000Z",
  },
  {
    id: "evt-other-farmer",
    listingId: "listing-b",
    farmerAddress: "GOTHER",
    metric: "VIEW",
    occurredAt: "2026-01-31T00:00:00.000Z",
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

describe("farmer listing analytics", () => {
  it("documents the supported time windows", () => {
    expect(ANALYTICS_WINDOWS.map((window) => window.id)).toEqual(["7d", "30d", "90d"]);
    expect(ANALYTICS_WINDOWS.find((window) => window.id === "7d")?.days).toBe(7);
  });

  it("filters events by the selected window relative to now", () => {
    const recent = filterAnalyticsEventsByWindow(events, "7d", NOW);
    expect(recent.map((event) => event.id)).toEqual([
      "evt-view-recent",
      "evt-cart-recent",
      "evt-sale-recent",
    ]);
  });

  it("keeps views, cart additions, and sales as distinct metrics scoped to the farmer", () => {
    const rows = summarizeListingAnalytics(events, FARMER, "30d", NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      listingId: "listing-a",
      views: 1,
      cartAdditions: 1,
      completedSales: 1,
    });
  });

  it("never exposes another farmer's events", () => {
    const rows = summarizeListingAnalytics(events, FARMER, "90d", NOW);
    expect(rows.some((row) => row.listingId === "listing-b")).toBe(false);
  });
});
