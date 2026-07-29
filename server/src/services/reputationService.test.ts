import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/database.js", () => ({
  prisma: {
    order: {
      count: vi.fn(),
    },
    dispute: {
      count: vi.fn(),
    },
  },
}));

vi.mock("./reviewService.js", () => ({
  getReviewSummary: vi.fn(),
}));

import { prisma } from "../config/database.js";
import { getReviewSummary } from "./reviewService.js";
import {
  clearReputationCache,
  getReputationSnapshot,
} from "./reputationService.js";

const orderCount = vi.mocked(prisma.order.count);
const disputeCount = vi.mocked(prisma.dispute.count);
const reviewSummary = vi.mocked(getReviewSummary);

beforeEach(() => {
  vi.clearAllMocks();
  clearReputationCache();
});

describe("reputationService", () => {
  it("combines on-chain activity with review data", async () => {
    orderCount
      .mockResolvedValueOnce(10 as never)
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(12 as never);
    disputeCount.mockResolvedValueOnce(1 as never);
    reviewSummary.mockResolvedValueOnce({
      reviewCount: 4,
      averageRating: 4.5,
      verifiedReviewCount: 4,
    });

    const snapshot = await getReputationSnapshot("GTEST");

    expect(snapshot.walletAddress).toBe("GTEST");
    expect(snapshot.completedOrders).toBe(10);
    expect(snapshot.disputedOrders).toBe(1);
    expect(snapshot.onChainScore).not.toBeNull();
    expect(snapshot.averageReviewScore).toBe(4.5);
    expect(snapshot.score).toBeGreaterThan(0);
  });

  it("handles missing on-chain data without failing", async () => {
    orderCount
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never);
    disputeCount.mockResolvedValueOnce(0 as never);
    reviewSummary.mockResolvedValueOnce({
      reviewCount: 3,
      averageRating: 4.8,
      verifiedReviewCount: 3,
    });

    const snapshot = await getReputationSnapshot("GNOCHAIN");

    expect(snapshot.onChainScore).toBeNull();
    expect(snapshot.averageReviewScore).toBe(4.8);
    expect(snapshot.reviewCount).toBe(3);
    expect(snapshot.score).toBeGreaterThan(0);
  });

  it("handles missing review data without failing", async () => {
    orderCount
      .mockResolvedValueOnce(6 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(6 as never);
    disputeCount.mockResolvedValueOnce(0 as never);
    reviewSummary.mockResolvedValueOnce({
      reviewCount: 0,
      averageRating: null,
      verifiedReviewCount: 0,
    });

    const snapshot = await getReputationSnapshot("GNOREVIEW");

    expect(snapshot.onChainScore).not.toBeNull();
    expect(snapshot.averageReviewScore).toBeNull();
    expect(snapshot.reviewCount).toBe(0);
    expect(snapshot.score).toBeGreaterThan(0);
  });
});

