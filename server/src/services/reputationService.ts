import { prisma } from "../config/database.js";
import logger from "../config/logger.js";
import { getReviewSummary } from "./reviewService.js";

export interface ReputationSnapshot {
  walletAddress: string;
  score: number;
  onChainScore: number | null;
  averageReviewScore: number | null;
  reviewCount: number;
  completedOrders: number;
  disputedOrders: number;
  disputeRate: number;
  cacheHit: boolean;
  computedAt: string;
  cacheExpiresAt: string;
}

interface CacheEntry {
  value: ReputationSnapshot;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const reputationCache = new Map<string, CacheEntry>();

// ── System-of-record policy (#694) ───────────────────────────────────────────
// The Prisma-derived composite score (completionRate + disputeRate + review
// average) is the CURRENT system of record for farmer reputation. The on-chain
// registry (`registry::record_order_outcome`) is the intended long-term source
// of truth once the escrow contract compile-fix (#694 prerequisite) lands and
// the call-sites in both escrow contracts are wired up.
//
// Until that bridge is in place `onChainScore` in the snapshot is the
// Prisma-derived approximation (see `loadOnChainSignals`). When the on-chain
// registry is wired, replace the Prisma query with a read of `get_reputation`
// from the registry contract and set `onChainScore` to the returned value.
//
// Anti-gaming floor: only orders above this threshold count toward reputation
// to resist cheap self-dealing score inflation between colluding addresses.
export const MIN_ORDER_AMOUNT_FOR_REPUTATION = 1_000_000; // 1 XLM in stroops

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeWallet(walletAddress: string): string {
  return walletAddress.toLowerCase();
}

function computeCompositeScore(params: {
  onChainScore: number | null;
  averageReviewScore: number | null;
  reviewCount: number;
  disputeRate: number;
}): number {
  const onChainComponent = params.onChainScore ?? 50;
  const reviewComponent = params.averageReviewScore !== null ? params.averageReviewScore * 20 : 50;
  const volumeBonus = Math.min(params.reviewCount * 1.5, 12);
  const disputePenalty = params.disputeRate * 0.4;

  return clamp(
    Math.round(onChainComponent * 0.55 + reviewComponent * 0.35 + volumeBonus - disputePenalty),
    0,
    100,
  );
}

async function loadOnChainSignals(walletAddress: string): Promise<{
  completedOrders: number;
  disputedOrders: number;
  onChainScore: number | null;
  disputeRate: number;
}> {
  const participantFilter = {
    OR: [{ buyerAddress: walletAddress }, { sellerAddress: walletAddress }],
  };

  // Only count orders above the anti-gaming floor (#694).
  const qualifiedFilter = {
    ...participantFilter,
    amount: { gte: MIN_ORDER_AMOUNT_FOR_REPUTATION },
  };

  const [completedOrders, disputedOrders, totalOrders] = await Promise.all([
    prisma.order.count({
      where: {
        ...qualifiedFilter,
        status: "COMPLETED",
      },
    }),
    prisma.dispute.count({
      where: {
        order: {
          is: qualifiedFilter,
        },
      },
    }),
    prisma.order.count({
      where: qualifiedFilter,
    }),
  ]);

  if (totalOrders === 0) {
    return {
      completedOrders,
      disputedOrders,
      onChainScore: null,
      disputeRate: 0,
    };
  }

  const completionRate = completedOrders / totalOrders;
  const disputeRate = disputedOrders / totalOrders;
  const onChainScore = clamp(
    Math.round(40 + completionRate * 45 - disputeRate * 35),
    0,
    100,
  );

  return {
    completedOrders,
    disputedOrders,
    onChainScore,
    disputeRate: Number((disputeRate * 100).toFixed(2)),
  };
}

async function computeReputation(walletAddress: string): Promise<ReputationSnapshot> {
  const normalizedWallet = normalizeWallet(walletAddress);
  const [{ completedOrders, disputedOrders, onChainScore, disputeRate }, reviewSummary] =
    await Promise.all([
      loadOnChainSignals(normalizedWallet),
      getReviewSummary(walletAddress),
    ]);

  const score = computeCompositeScore({
    onChainScore,
    averageReviewScore: reviewSummary.averageRating,
    reviewCount: reviewSummary.reviewCount,
    disputeRate,
  });

  const computedAt = new Date();
  return {
    walletAddress,
    score,
    onChainScore,
    averageReviewScore: reviewSummary.averageRating,
    reviewCount: reviewSummary.reviewCount,
    completedOrders,
    disputedOrders,
    disputeRate,
    cacheHit: false,
    computedAt: computedAt.toISOString(),
    cacheExpiresAt: new Date(computedAt.getTime() + CACHE_TTL_MS).toISOString(),
  };
}

export async function getReputationSnapshot(walletAddress: string): Promise<ReputationSnapshot> {
  const normalizedWallet = normalizeWallet(walletAddress);
  const cached = reputationCache.get(normalizedWallet);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cacheHit: true };
  }

  const value = await computeReputation(walletAddress);
  reputationCache.set(normalizedWallet, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return value;
}

export function clearReputationCache(): void {
  reputationCache.clear();
}

export function getReputationCacheTtlMs(): number {
  return CACHE_TTL_MS;
}

export async function refreshReputationSnapshot(walletAddress: string): Promise<ReputationSnapshot> {
  reputationCache.delete(normalizeWallet(walletAddress));
  try {
    return await getReputationSnapshot(walletAddress);
  } catch (error) {
    logger.error("Failed to refresh reputation snapshot", { error, walletAddress });
    throw error;
  }
}
