import crypto from "node:crypto";
import { prisma } from "../config/database.js";
import { ApiError, ConflictError, NotFoundError, ValidationError } from "../http/errors.js";
import logger from "../config/logger.js";

/** Platform-fee credit granted to a referrer, in basis points of the
 * referee's first confirmed order/investment amount that triggered the
 * reward. Kept modest and capped so referral rewards cannot be used to
 * siphon meaningful value even under coordinated abuse. */
const REFERRAL_REWARD_BPS = 100n; // 1%
const REFERRAL_REWARD_BPS_DENOM = 10_000n;
/** Hard cap on a single reward credit regardless of order/investment size. */
const REFERRAL_REWARD_CAP = 5_000n;

function generateCode(): string {
  return crypto.randomBytes(6).toString("base64url").toUpperCase().slice(0, 8);
}

export class ReferralService {
  /** Fetch or lazily create a wallet's referral code. */
  static async getOrCreateCode(walletAddress: string) {
    const existing = await prisma.referralCode.findUnique({ where: { walletAddress } });
    if (existing) return existing;

    // Retry on the (astronomically unlikely) chance of a code collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await prisma.referralCode.create({
          data: { walletAddress, code: generateCode() },
        });
      } catch (error) {
        const isUniqueViolation =
          error instanceof Object && "code" in error && (error as { code?: string }).code === "P2002";
        if (!isUniqueViolation) throw error;
      }
    }
    throw new ApiError(500, "Internal Server Error", "Failed to allocate a unique referral code");
  }

  /**
   * Records a referrer/referee linkage at signup time. Reward is NOT granted
   * here — only tracked, pending the referee's first confirmed economic
   * event (Issue #661 acceptance criteria: resist Sybil farming by rewarding
   * real activity, not mere signup).
   */
  static async recordSignup(refereeWallet: string, referralCode: string) {
    if (!referralCode) {
      throw new ValidationError("referralCode is required");
    }

    const codeRow = await prisma.referralCode.findUnique({ where: { code: referralCode } });
    if (!codeRow) {
      throw new NotFoundError("Referral code", referralCode);
    }

    if (codeRow.walletAddress.toLowerCase() === refereeWallet.toLowerCase()) {
      // Self-referral: silently ignored rather than erroring, so a wallet
      // pasting its own code during onboarding doesn't see a scary failure —
      // it just never becomes eligible for a reward.
      logger.warn("[ReferralService] Self-referral attempt ignored", { refereeWallet });
      return null;
    }

    const existing = await prisma.referral.findUnique({ where: { refereeWallet } });
    if (existing) {
      throw new ConflictError("This wallet is already linked to a referrer");
    }

    return prisma.referral.create({
      data: {
        referrerWallet: codeRow.walletAddress,
        refereeWallet,
        code: referralCode,
        status: "PENDING",
      },
    });
  }

  /**
   * Called when a referee's order is confirmed on-chain (order.confirmed
   * event) or an investment lands on a campaign (campaign.invested event) —
   * the first real economic event, per acceptance criteria. Idempotent: a
   * referral already REWARDED or INELIGIBLE is a no-op.
   */
  static async triggerRewardOnConfirmedActivity(params: {
    refereeWallet: string;
    amount: string;
    triggerOrderId?: string;
    triggerCampaignId?: string;
  }): Promise<void> {
    const { refereeWallet, amount, triggerOrderId, triggerCampaignId } = params;

    const referral = await prisma.referral.findUnique({ where: { refereeWallet } });
    if (!referral || referral.status !== "PENDING") {
      return;
    }

    if (referral.referrerWallet.toLowerCase() === refereeWallet.toLowerCase()) {
      // Defensive: should already be blocked at signup, but never reward self-referral.
      await prisma.referral.update({
        where: { id: referral.id },
        data: { status: "INELIGIBLE" },
      });
      return;
    }

    let amountNum: bigint;
    try {
      amountNum = BigInt(amount);
    } catch {
      logger.warn("[ReferralService] Non-numeric amount on trigger, skipping reward", { amount, refereeWallet });
      return;
    }
    if (amountNum <= 0n) {
      // Never-transacting or zero-value events do not count — the reward
      // only fires on a genuine confirmed economic event with value.
      return;
    }

    let reward = (amountNum * REFERRAL_REWARD_BPS) / REFERRAL_REWARD_BPS_DENOM;
    if (reward > REFERRAL_REWARD_CAP) reward = REFERRAL_REWARD_CAP;
    if (reward <= 0n) return;

    await prisma.$transaction(async (tx) => {
      await tx.referral.update({
        where: { id: referral.id },
        data: {
          status: "REWARDED",
          rewardedAt: new Date(),
          rewardAmount: reward.toString(),
          triggerOrderId: triggerOrderId ?? null,
          triggerCampaignId: triggerCampaignId ?? null,
        },
      });
      await tx.feeCredit.create({
        data: {
          walletAddress: referral.referrerWallet,
          amount: reward.toString(),
          reason: `referral:${referral.id}`,
          sourceReferralId: referral.id,
        },
      });
    });

    logger.info("[ReferralService] Referral reward issued", {
      referralId: referral.id,
      referrer: referral.referrerWallet,
      reward: reward.toString(),
    });
  }

  /** Admin/NGO-facing cohort performance view (Issue #661 acceptance criteria). */
  static async getCohortPerformance(referrerWallet?: string) {
    const where = referrerWallet ? { referrerWallet } : {};

    const [total, rewarded, pending, ineligible, rewardAgg] = await Promise.all([
      prisma.referral.count({ where }),
      prisma.referral.count({ where: { ...where, status: "REWARDED" } }),
      prisma.referral.count({ where: { ...where, status: "PENDING" } }),
      prisma.referral.count({ where: { ...where, status: "INELIGIBLE" } }),
      prisma.referral.findMany({
        where: { ...where, status: "REWARDED" },
        select: { rewardAmount: true },
      }),
    ]);

    const totalRewarded = rewardAgg.reduce((sum, r) => sum + BigInt(r.rewardAmount ?? "0"), 0n);

    return {
      totalReferrals: total,
      rewarded,
      pending,
      ineligible,
      totalRewardAmount: totalRewarded.toString(),
      conversionRate: total === 0 ? 0 : rewarded / total,
    };
  }

  /** Per-referrer breakdown for cooperative/NGO admin dashboards. */
  static async listReferralsByReferrer(referrerWallet: string) {
    return prisma.referral.findMany({
      where: { referrerWallet },
      orderBy: { createdAt: "desc" },
    });
  }

  static async getFeeCreditBalance(walletAddress: string): Promise<string> {
    const credits = await prisma.feeCredit.findMany({
      where: { walletAddress, consumedAt: null },
      select: { amount: true },
    });
    return credits.reduce((sum, c) => sum + BigInt(c.amount), 0n).toString();
  }
}
