import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../config/database.js", () => ({
  prisma: {
    priceIndex: { upsert: vi.fn(), findMany: vi.fn() },
  },
}));

import { aggregatePriceIndex, getPriceIndex, invalidatePriceIndexCache, type PricePoint } from "./priceIndexService.js";
import { prisma } from "../config/database.js";

const findMany = vi.mocked(prisma.priceIndex.findMany);

describe("aggregatePriceIndex", () => {
  it("returns an empty index for no data (sparse case)", () => {
    expect(aggregatePriceIndex([])).toEqual([]);
  });

  it("computes avg/min/max/count for a single crop+region+currency group", () => {
    const points: PricePoint[] = [
      { crop: "Maize", region: "Kaduna", currency: "USDC", price: 10, source: "price_history" },
      { crop: "Maize", region: "Kaduna", currency: "USDC", price: 20, source: "farmer_supply" },
      { crop: "Maize", region: "Kaduna", currency: "USDC", price: 30, source: "buyer_demand" },
    ];

    const [entry] = aggregatePriceIndex(points);
    expect(entry).toMatchObject({
      crop: "Maize",
      region: "Kaduna",
      currency: "USDC",
      avgPrice: 20,
      minPrice: 10,
      maxPrice: 30,
      sampleCount: 3,
      sourceCounts: { price_history: 1, farmer_supply: 1, buyer_demand: 1 },
    });
  });

  it("keeps multi-currency data in separate entries rather than averaging across currencies", () => {
    const points: PricePoint[] = [
      { crop: "Cocoa", region: "Ondo", currency: "USDC", price: 100, source: "price_history" },
      { crop: "Cocoa", region: "Ondo", currency: "XLM", price: 500, source: "price_history" },
    ];

    const entries = aggregatePriceIndex(points);
    expect(entries).toHaveLength(2);

    const usdc = entries.find((e) => e.currency === "USDC");
    const xlm = entries.find((e) => e.currency === "XLM");
    expect(usdc).toMatchObject({ avgPrice: 100, sampleCount: 1 });
    expect(xlm).toMatchObject({ avgPrice: 500, sampleCount: 1 });
  });

  it("buckets a sparse single data point on its own without averaging against unrelated crops", () => {
    const points: PricePoint[] = [
      { crop: "Yam", region: "Benue", currency: "USDC", price: 42, source: "buyer_demand" },
      { crop: "Rice", region: "Kano", currency: "USDC", price: 99, source: "farmer_supply" },
    ];

    const entries = aggregatePriceIndex(points);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.crop === "Yam")).toMatchObject({
      sampleCount: 1,
      avgPrice: 42,
      minPrice: 42,
      maxPrice: 42,
    });
  });

  it("falls back to an UNKNOWN region bucket when region is missing", () => {
    const points: PricePoint[] = [
      { crop: "Millet", region: "", currency: "USDC", price: 15, source: "farmer_supply" },
    ];

    const [entry] = aggregatePriceIndex(points);
    expect(entry!.region).toBe("UNKNOWN");
  });

  it("ignores non-finite prices without throwing", () => {
    const points: PricePoint[] = [
      { crop: "Sorghum", region: "Kano", currency: "USDC", price: Number.NaN, source: "price_history" },
    ];
    expect(aggregatePriceIndex(points)).toEqual([]);
  });
});

describe("getPriceIndex caching", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidatePriceIndexCache();
  });

  it("serves repeated identical queries from cache instead of hitting the DB again", async () => {
    findMany.mockResolvedValue([
      {
        crop: "Maize",
        region: "Kaduna",
        currency: "USDC",
        avgPrice: 20,
        minPrice: 10,
        maxPrice: 30,
        sampleCount: 3,
        sourceCounts: { price_history: 1, farmer_supply: 1, buyer_demand: 1 },
      },
    ] as never);

    const first = await getPriceIndex({ crop: "Maize" });
    const second = await getPriceIndex({ crop: "Maize" });

    expect(first).toEqual(second);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("re-queries the DB when filters differ", async () => {
    findMany.mockResolvedValue([] as never);

    await getPriceIndex({ crop: "Maize" });
    await getPriceIndex({ crop: "Rice" });

    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
