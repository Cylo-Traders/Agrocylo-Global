import { z } from "zod";
import { positiveInt128, stellarAddress, uuidParam } from "./common.js";

export const CreateOrderSchema = z.object({
  buyerAddress: stellarAddress,
  campaignId: uuidParam,
  amount: positiveInt128,
  transactionHash: z.string().min(1, "Transaction hash is required"),
});

export const ConfirmOrderSchema = z.object({
  buyerAddress: stellarAddress,
});

export const OrderIdParamSchema = z.object({
  id: uuidParam,
});

export const ListOrdersQuerySchema = z
  .object({
    buyerAddress: stellarAddress.optional(),
    farmerAddress: stellarAddress.optional(),
  })
  .refine((q) => Boolean(q.buyerAddress ?? q.farmerAddress), {
    message: "buyerAddress or farmerAddress query param is required",
    path: ["buyerAddress"],
  });

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type ConfirmOrderInput = z.infer<typeof ConfirmOrderSchema>;
export type ListOrdersQuery = z.infer<typeof ListOrdersQuerySchema>;
