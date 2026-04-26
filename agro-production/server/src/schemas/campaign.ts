import { z } from "zod";

const positiveInt128 = z
  .string()
  .regex(/^\d+$/, "Must be a positive integer string")
  .refine((v) => BigInt(v) > 0n, "Must be greater than zero");

export const CreateCampaignSchema = z.object({
  farmerAddress: z
    .string()
    .min(56, "Invalid Stellar address")
    .max(56, "Invalid Stellar address"),
  tokenAddress: z
    .string()
    .min(56, "Invalid Stellar address")
    .max(56, "Invalid Stellar address"),
  targetAmount: positiveInt128,
  deadline: z
    .string()
    .datetime({ message: "Invalid ISO 8601 datetime" })
    .refine(
      (d) => new Date(d).getTime() > Date.now(),
      "Deadline must be in the future",
    ),
});

export const InvestSchema = z.object({
  investorAddress: z.string().min(56).max(56),
  amount: positiveInt128,
});

export const CampaignIdParamSchema = z.object({
  id: z.string().uuid("Campaign ID must be a UUID"),
});

export const ListCampaignsQuerySchema = z.object({
  status: z
    .enum(["FUNDING", "FUNDED", "IN_PRODUCTION", "HARVESTED", "SETTLED", "FAILED", "DISPUTED"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;
export type InvestInput = z.infer<typeof InvestSchema>;
export type ListCampaignsQuery = z.infer<typeof ListCampaignsQuerySchema>;
