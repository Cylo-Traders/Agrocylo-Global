import { z } from "zod";
import {
  campaignStatusEnum,
  isoDateTime,
  paginationQuery,
  positiveInt128,
  stellarAddress,
  uuidParam,
} from "./common.js";

export const CreateCampaignSchema = z.object({
  farmerAddress: stellarAddress,
  tokenAddress: stellarAddress,
  targetAmount: positiveInt128,
  deadline: isoDateTime.refine(
    (d) => new Date(d).getTime() > Date.now(),
    "Deadline must be in the future",
  ),
  transactionHash: z.string().min(1, "Transaction hash is required"),
});

export const InvestSchema = z.object({
  investorAddress: stellarAddress,
  amount: positiveInt128,
  transactionHash: z.string().min(1, "Transaction hash is required"),
});

export const CampaignIdParamSchema = z.object({
  id: uuidParam,
});

export const ListCampaignsQuerySchema = z.object({
  status: campaignStatusEnum.optional(),
  farmerAddress: stellarAddress.optional(),
  ...paginationQuery,
});

export const ListInvestmentsQuerySchema = z.object({
  investorAddress: stellarAddress,
});

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;
export type InvestInput = z.infer<typeof InvestSchema>;
export type ListCampaignsQuery = z.infer<typeof ListCampaignsQuerySchema>;
export type ListInvestmentsQuery = z.infer<typeof ListInvestmentsQuerySchema>;
