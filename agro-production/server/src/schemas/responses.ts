import { z } from "zod";
import {
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
