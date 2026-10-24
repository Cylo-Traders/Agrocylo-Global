import { z } from 'zod';
import { uuidParam } from './common.js';

export const GroupOrderStatusSchema = z.enum(['open', 'expired', 'completed']);

export const GroupOrderSchema = z.object({
  id: z.string(),
  productId: z.string().nullable().optional(),
  productName: z.string().min(1),
  currentQuantity: z.number().int().nonnegative(),
  targetQuantity: z.number().int().positive(),
  pricePerUnit: z.number().nonnegative(),
  expiresAt: z.string().datetime(),
  status: GroupOrderStatusSchema,
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const GroupOrderListSchema = z.array(GroupOrderSchema);

export const GroupOrderIdParamSchema = z.object({
  id: uuidParam,
});

export const JoinGroupOrderBodySchema = z
  .object({
    quantity: z.number().int().positive().max(10_000).optional(),
  })
  .optional();

export const JoinGroupOrderResponseSchema = GroupOrderSchema.extend({
  joined: z.boolean(),
  idempotentReplay: z.boolean(),
});

export const GroupOrderUpdatedPayloadSchema = z.object({
  orderId: z.string(),
  currentQuantity: z.number().int().nonnegative(),
  targetQuantity: z.number().int().positive(),
  status: GroupOrderStatusSchema,
});

export type GroupOrderDto = z.infer<typeof GroupOrderSchema>;
export type JoinGroupOrderResponseDto = z.infer<typeof JoinGroupOrderResponseSchema>;
export type GroupOrderUpdatedPayload = z.infer<typeof GroupOrderUpdatedPayloadSchema>;
