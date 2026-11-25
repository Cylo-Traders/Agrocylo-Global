import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useWallet", () => ({ useWallet: () => ({}) }));
vi.mock("@/services/orderService", () => ({}));

import { buildMonthlyOrderBuckets } from "./useOrders";

const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const order = (status: string, xlm: number, iso: string) => ({
  status,
  amount: BigInt(xlm * 1e7),
  createdAt: ts(iso),
});

describe("buildMonthlyOrderBuckets (#1473)", () => {
  it("returns no buckets for an empty or undated dataset", () => {
    expect(buildMonthlyOrderBuckets([])).toEqual([]);
    expect(
      buildMonthlyOrderBuckets([{ status: "Completed", amount: 10n, createdAt: 0 }]),
    ).toEqual([]);
  });

  it("assigns orders across month and year boundaries to the right UTC bucket", () => {
    const buckets = buildMonthlyOrderBuckets([
      order("Completed", 10, "2025-12-31T23:59:59Z"),
      order("Completed", 5, "2026-01-01T00:00:00Z"),
      order("Completed", 2, "2026-01-31T12:00:00Z"),
    ]);
    expect(buckets.map((b) => [b.key, b.month, b.gross, b.completed])).toEqual([
      ["2025-12", "Dec 2025", 10, 1],
      ["2026-01", "Jan 2026", 7, 2],
    ]);
    expect(buckets[1].net).toBeCloseTo(7 * 0.97);
  });

  it("falls back to on-chain `timestamp` when `createdAt` is absent", () => {
    const [bucket] = buildMonthlyOrderBuckets([
      { status: "Completed", amount: 30_000_000n, timestamp: ts("2026-02-10T00:00:00Z") },
    ]);
    expect(bucket).toMatchObject({ key: "2026-02", gross: 3 });
  });

  it("zero-fills months between the first and last order", () => {
    const buckets = buildMonthlyOrderBuckets([
      order("Completed", 1, "2026-01-15T00:00:00Z"),
      order("Completed", 3, "2026-04-15T00:00:00Z"),
    ]);
    expect(buckets.map((b) => [b.key, b.gross])).toEqual([
      ["2026-01", 1],
      ["2026-02", 0],
      ["2026-03", 0],
      ["2026-04", 3],
    ]);
  });

  it("excludes non-completed orders from earnings but counts them by status", () => {
    const [bucket] = buildMonthlyOrderBuckets([
      order("Completed", 4, "2026-03-02T00:00:00Z"),
      order("Pending", 100, "2026-03-03T00:00:00Z"),
      order("Refunded", 50, "2026-03-04T00:00:00Z"),
      order("Cancelled", 25, "2026-03-05T00:00:00Z"),
    ]);
    expect(bucket).toMatchObject({
      gross: 4,
      completed: 1,
      pending: 1,
      refunded: 1,
    });
  });
});
