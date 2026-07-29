import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/database.js", () => ({
  prisma: {
    referralCode: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    referral: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    feeCredit: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { ReferralService } from "./referralService.js";
import { prisma } from "../config/database.js";

const mockReferralCode = vi.mocked(prisma.referralCode);
const mockReferral = vi.mocked(prisma.referral);
const mockFeeCredit = vi.mocked(prisma.feeCredit);
const mockTransaction = vi.mocked(prisma.$transaction);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReferralService.recordSignup", () => {
  it("ignores self-referral and does not create a referral row", async () => {
    mockReferralCode.findUnique.mockResolvedValueOnce({
      walletAddress: "GSAME",
      code: "ABC12345",
      createdAt: new Date(),
    } as any);

    const result = await ReferralService.recordSignup("GSAME", "ABC12345");

    expect(result).toBeNull();
    expect(mockReferral.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundError for an unknown referral code", async () => {
    mockReferralCode.findUnique.mockResolvedValueOnce(null);

    await expect(ReferralService.recordSignup("GREFEREE", "BADCODE1")).rejects.toThrow();
    expect(mockReferral.create).not.toHaveBeenCalled();
  });

  it("throws ConflictError if the referee is already linked", async () => {
    mockReferralCode.findUnique.mockResolvedValueOnce({
      walletAddress: "GREFERRER",
      code: "ABC12345",
      createdAt: new Date(),
    } as any);
    mockReferral.findUnique.mockResolvedValueOnce({ id: "r1" } as any);

    await expect(ReferralService.recordSignup("GREFEREE", "ABC12345")).rejects.toThrow();
    expect(mockReferral.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING referral for a valid distinct referrer/referee pair", async () => {
    mockReferralCode.findUnique.mockResolvedValueOnce({
      walletAddress: "GREFERRER",
      code: "ABC12345",
      createdAt: new Date(),
    } as any);
    mockReferral.findUnique.mockResolvedValueOnce(null);
    mockReferral.create.mockResolvedValueOnce({ id: "r1", status: "PENDING" } as any);

    const result = await ReferralService.recordSignup("GREFEREE", "ABC12345");

    expect(result).toEqual({ id: "r1", status: "PENDING" });
    expect(mockReferral.create).toHaveBeenCalledWith({
      data: {
        referrerWallet: "GREFERRER",
        refereeWallet: "GREFEREE",
        code: "ABC12345",
        status: "PENDING",
      },
    });
  });
});

describe("ReferralService.triggerRewardOnConfirmedActivity", () => {
  it("does nothing when the referee never transacted (amount is zero)", async () => {
    mockReferral.findUnique.mockResolvedValueOnce({
      id: "r1",
      referrerWallet: "GREFERRER",
      refereeWallet: "GREFEREE",
      status: "PENDING",
    } as any);

    await ReferralService.triggerRewardOnConfirmedActivity({
      refereeWallet: "GREFEREE",
      amount: "0",
    });

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("does nothing when there is no pending referral for the wallet", async () => {
    mockReferral.findUnique.mockResolvedValueOnce(null);

    await ReferralService.triggerRewardOnConfirmedActivity({
      refereeWallet: "GNOBODY",
      amount: "10000",
    });

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("does nothing when the referral is already REWARDED (idempotent)", async () => {
    mockReferral.findUnique.mockResolvedValueOnce({
      id: "r1",
      referrerWallet: "GREFERRER",
      refereeWallet: "GREFEREE",
      status: "REWARDED",
    } as any);

    await ReferralService.triggerRewardOnConfirmedActivity({
      refereeWallet: "GREFEREE",
      amount: "10000",
    });

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("marks a self-referral INELIGIBLE defensively and does not reward it", async () => {
    mockReferral.findUnique.mockResolvedValueOnce({
      id: "r1",
      referrerWallet: "GSAME",
      refereeWallet: "GSAME",
      status: "PENDING",
    } as any);

    await ReferralService.triggerRewardOnConfirmedActivity({
      refereeWallet: "GSAME",
      amount: "10000",
    });

    expect(mockReferral.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "INELIGIBLE" },
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("grants a capped fee credit and marks the referral REWARDED on a real confirmed event", async () => {
    mockReferral.findUnique.mockResolvedValueOnce({
      id: "r1",
      referrerWallet: "GREFERRER",
      refereeWallet: "GREFEREE",
      status: "PENDING",
    } as any);
    mockTransaction.mockImplementationOnce(async (fn: any) =>
      fn({ referral: mockReferral, feeCredit: mockFeeCredit }),
    );

    await ReferralService.triggerRewardOnConfirmedActivity({
      refereeWallet: "GREFEREE",
      amount: "1000000", // 1% = 10_000, above the 5_000 cap -> capped
      triggerOrderId: "order-1",
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockReferral.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r1" },
        data: expect.objectContaining({ status: "REWARDED", rewardAmount: "5000" }),
      }),
    );
    expect(mockFeeCredit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ walletAddress: "GREFERRER", amount: "5000" }),
      }),
    );
  });
});
