import { z } from "zod";

/** Stellar public key (G…, 56 characters). */
export const stellarAddress = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address");

/** Soroban i128 amounts stored as decimal strings. */
export const positiveInt128 = z
  .string()
  .regex(/^\d+$/, "Must be a positive integer string")
  .refine((v) => BigInt(v) > 0n, "Must be greater than zero");

export const campaignStatusEnum = z.enum([
  "FUNDING",
  "FUNDED",
  "IN_PRODUCTION",
  "HARVESTED",
  "SETTLED",
  "FAILED",
  "DISPUTED",
]);

export const orderStatusEnum = z.enum(["PENDING", "CONFIRMED"]);

export const basketStatusEnum = z.enum(["OPEN", "FUNDED"]);

export const uuidParam = z.string().uuid();

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const isoDateTime = z.string().datetime();
