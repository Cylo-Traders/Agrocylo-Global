import { z } from "zod";

const positiveInt128 = z
  .string()
  .regex(/^\d+$/, "Must be a positive integer string")
  .refine((v) => BigInt(v) > 0n, "Must be greater than zero");

export const CreateOrderSchema = z.object({
  buyerAddress: z.string().min(56).max(56),
  campaignId: z.string().uuid(),
  amount: positiveInt128,
});

export const ConfirmOrderSchema = z.object({
  buyerAddress: z.string().min(56).max(56),
});

export const OrderIdParamSchema = z.object({
  id: z.string().uuid("Order ID must be a UUID"),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type ConfirmOrderInput = z.infer<typeof ConfirmOrderSchema>;
