import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("@/lib/apiClient", () => ({
  __esModule: true,
  default: { get: mockGet },
  isApiError: (err: unknown) =>
    err instanceof Error && (err as { name?: string }).name === "ApiError",
  isNetworkError: (err: unknown) =>
    err instanceof Error && (err as { name?: string }).name === "NetworkError",
}));

import {
  mapInvestorBasket,
  fetchInvestorBasket,
  type InvestorBasketSummaryDTO,
} from "@/services/basketService";

function serverSummary(
  overrides: Partial<InvestorBasketSummaryDTO> = {},
): InvestorBasketSummaryDTO {
  const base: InvestorBasketSummaryDTO = {
    basket: {
      id: "11111111-1111-4111-8111-111111111111",
      onChainId: "42",
      constituentsCount: 2,
      totalDeposited: "200000000",
      status: "OPEN",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
    positions: [
      {
        basketId: "11111111-1111-4111-8111-111111111111",
        onChainId: "42",
        depositorAddress: "GBP7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7X",
        // 10 XLM = 100_000_000 stroops
        amount: "100000000",
        claimed: false,
        withdrawn: false,
        payoutAmount: null,
        ledger: 7,
        txHash: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        basketId: "11111111-1111-4111-8111-111111111111",
        onChainId: "42",
        depositorAddress: "GBP7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7X",
        // 10 XLM, claimed with 6 XLM payout
        amount: "100000000",
        claimed: true,
        withdrawn: false,
        payoutAmount: "60000000",
        ledger: 8,
        txHash: "abc",
        createdAt: "2026-01-01T12:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    // 20 XLM allocated, 6 XLM returned
    totalAllocated: "200000000",
    totalReturned: "60000000",
  };
  return { ...base, ...overrides };
}

class FakeApiError extends Error {
  status: number;
  constructor(status: number) {
    super("api");
    this.name = "ApiError";
    this.status = status;
  }
}

class FakeNetworkError extends Error {
  constructor() {
    super("network");
    this.name = "NetworkError";
  }
}

describe("basketService contract mapping (#1050)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps stroop strings to exact 7-dp XLM strings without float arithmetic", () => {
    const summary = mapInvestorBasket(
      serverSummary({
        // 1e16 + 1 stroops would lose precision through Number
        positions: [
          {
            basketId: "11111111-1111-4111-8111-111111111111",
            onChainId: "42",
            depositorAddress: "GBP7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7X",
            amount: "10000000000000001",
            claimed: false,
            withdrawn: false,
            payoutAmount: null,
            ledger: 7,
            txHash: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        totalAllocated: "10000000000000001",
        totalReturned: "0",
      }),
    );

    expect(summary.totalAllocated).toBe("1,000,000,000.0000001");
    expect(summary.positions[0]!.allocatedAmount).toBe("1,000,000,000.0000001");
  });

  it("derives integer weights proportional to allocation", () => {
    const summary = mapInvestorBasket(serverSummary());
    // 10 XLM of 20 XLM total -> 50 for each position
    expect(summary.positions.map((p) => p.weight)).toEqual([50, 50]);
  });

  it("reports unclaimed positions with their allocation, claimed with payout", () => {
    const summary = mapInvestorBasket(serverSummary());

    expect(summary.positions[0]).toMatchObject({
      claimed: false,
      allocatedAmount: "10.0000000",
      currentValue: "10.0000000",
    });
    expect(summary.positions[1]).toMatchObject({
      claimed: true,
      allocatedAmount: "10.0000000",
      currentValue: "6.0000000",
    });
    expect(summary.totalReturned).toBe("6.0000000");
  });

  it("keeps the basket identity for the header", () => {
    const summary = mapInvestorBasket(serverSummary());
    expect(summary.basketId).toBe("11111111-1111-4111-8111-111111111111");
    expect(summary.onChainId).toBe("42");
    expect(summary.basketStatus).toBe("OPEN");
  });
});

describe("fetchInvestorBasket state contract (#1050)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a 200 response onto the view model", async () => {
    mockGet.mockResolvedValueOnce(serverSummary());

    const summary = await fetchInvestorBasket();

    expect(mockGet).toHaveBeenCalledWith("/investor/basket");
    expect(summary!.totalAllocated).toBe("20.0000000");
  });

  it("treats 404 as an empty basket (null), not an error", async () => {
    mockGet.mockRejectedValueOnce(new FakeApiError(404));

    await expect(fetchInvestorBasket()).resolves.toBeNull();
  });

  it("propagates a 401 as an ApiError for the unauthorized state", async () => {
    mockGet.mockRejectedValueOnce(new FakeApiError(401));

    await expect(fetchInvestorBasket()).rejects.toMatchObject({ status: 401 });
  });

  it("propagates network failures for the offline state", async () => {
    mockGet.mockRejectedValueOnce(new FakeNetworkError());

    await expect(fetchInvestorBasket()).rejects.toMatchObject({ name: "NetworkError" });
  });
});
