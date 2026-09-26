import { z } from "zod";
import {
  basketStatusEnum,
  campaignStatusEnum,
  orderStatusEnum,
  stellarAddress,
  uuidParam,
} from "./common.js";

const dateField = z.union([
  z.string().datetime(),
  z.date().transform((d) => d.toISOString()),
]);

const timestamps = {
  createdAt: dateField,
  updatedAt: dateField,
};

export const CampaignSchema = z.object({
  id: uuidParam,
  onChainId: z.string(),
  farmerAddress: stellarAddress,
  tokenAddress: stellarAddress,
  targetAmount: z.string(),
  totalRaised: z.string(),
  totalRevenue: z.string(),
  trancheReleased: z.string().optional(),
  deadline: dateField,
  status: campaignStatusEnum,
  ...timestamps,
});

export const CampaignSummarySchema = CampaignSchema.extend({
  _count: z
    .object({
      investments: z.number().int(),
      orders: z.number().int(),
    })
    .optional(),
});

export const CampaignListResponseSchema = z.object({
  data: z.array(CampaignSummarySchema),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
  }),
});

export const CampaignRefSchema = CampaignSchema.pick({
  id: true,
  onChainId: true,
  farmerAddress: true,
  tokenAddress: true,
  targetAmount: true,
  totalRaised: true,
  totalRevenue: true,
  status: true,
  deadline: true,
});

export const InvestmentSchema = z.object({
  id: uuidParam,
  campaignId: uuidParam,
  investorAddress: stellarAddress,
  amount: z.string(),
  ledger: z.number().int(),
  txHash: z.string().nullable().optional(),
  createdAt: dateField,
  campaign: CampaignRefSchema.optional(),
});

export const OrderCampaignRefSchema = z.object({
  farmerAddress: stellarAddress,
  tokenAddress: stellarAddress,
  onChainId: z.string(),
});

export const OrderSchema = z.object({
  id: uuidParam,
  onChainId: z.string(),
  campaignId: uuidParam,
  buyerAddress: stellarAddress,
  amount: z.string(),
  status: orderStatusEnum,
  ledger: z.number().int(),
  txHash: z.string().nullable().optional(),
  createdAt: dateField,
  updatedAt: dateField,
  campaign: OrderCampaignRefSchema.optional(),
});

export const MilestoneItemSchema = z.object({
  name: z.string(),
  percentage: z.number(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
});

export const CampaignMilestonesSchema = z.object({
  campaignId: z.string(),
  onChainId: z.string(),
  status: campaignStatusEnum,
  percentageReleased: z.number(),
  trancheReleased: z.string(),
  currentMilestone: z.string(),
  nextExpectedMilestone: z.string().nullable(),
  milestones: z.array(MilestoneItemSchema),
});

export const CampaignDetailSchema = CampaignSchema.extend({
  investments: z.array(InvestmentSchema).optional(),
  orders: z.array(OrderSchema).optional(),
});

export const BasketDepositSchema = z.object({
  id: uuidParam,
  basketId: uuidParam,
  depositorAddress: stellarAddress,
  amount: z.string(),
  claimed: z.boolean(),
  payoutAmount: z.string().nullable().optional(),
  withdrawn: z.boolean(),
  ledger: z.number().int(),
  txHash: z.string().nullable().optional(),
  createdAt: dateField,
  updatedAt: dateField,
});

export const BasketSchema = z.object({
  id: uuidParam,
  onChainId: z.string(),
  constituentsCount: z.number().int(),
  totalDeposited: z.string(),
  status: basketStatusEnum,
  ...timestamps,
});

export const BasketListResponseSchema = z.object({
  data: z.array(BasketSchema),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
  }),
});

export const BasketDetailSchema = BasketSchema.extend({
  deposits: z.array(BasketDepositSchema).optional(),
});

/**
 * Wallet-scoped investor portfolio (Issue #1051).
 *
 * Units: amounts are Soroban i128 **stroop** strings as stored on-chain
 * (1 XLM = 10_000_000 stroops). The client formats for display with exact
 * BigInt arithmetic and must not convert through Number.
 * The protocol has no fiat leg — amounts are XLM-denominated.
 */
export const InvestorPortfolioSummarySchema = z.object({
  /** The authenticated wallet the data belongs to. */
  investorAddress: stellarAddress,
  positions: z.array(InvestmentSchema),
  /** Invested amount for all listed positions, i128 stroops string. */
  totalInvested: z.string(),
  /** Realized returns for listed positions, i128 stroops string ("0" if none). */
  totalReturned: z.string(),
});

/**
 * Wallet-scoped investor basket summary (Issue #1050).
 *
 * Units: all monetary amounts are Soroban i128 stroop strings as stored
 * on-chain (1 XLM = 10_000_000 stroops); the client converts for display and
 * must keep the string form to retain precision.
 *
 * "Active basket" rule: the basket owning the investor's most recent
 * deposit (largest createdAt). Positions aggregate that basket only.
 */
export const InvestorBasketPositionSchema = z.object({
  basketId: uuidParam,
  onChainId: z.string(),
  depositorAddress: stellarAddress,
  /** Outstanding deposit for this position, i128 stroops string. */
  amount: z.string(),
  claimed: z.boolean(),
  withdrawn: z.boolean(),
  /** Set once claim_basket_returns is indexed; i128 stroops string. */
  payoutAmount: z.string().nullable().optional(),
  ledger: z.number().int(),
  txHash: z.string().nullable().optional(),
  createdAt: dateField,
  updatedAt: dateField,
});

export const InvestorBasketSummarySchema = z.object({
  basket: BasketSchema,
  positions: z.array(InvestorBasketPositionSchema),
  /** Sum of position amounts, i128 stroops string ("0" when empty). */
  totalAllocated: z.string(),
  /** Sum of realized payouts for claimed positions, i128 stroops string. */
  totalReturned: z.string(),
});

export const ValidationErrorSchema = z.object({
  type: z.string().url(),
  title: z.literal("Validation Failed"),
  status: z.literal(400),
  instance: z.string(),
  errors: z.array(
    z.object({
      field: z.string(),
      message: z.string(),
      code: z.string(),
    }),
  ),
});

export const ProblemDetailSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
});
