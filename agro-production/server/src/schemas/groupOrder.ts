import { z } from 'zod';
import { uuidParam } from './common.js';

/**
 * Issue #1257: schemas for the Group Orders endpoints.
 *
 * - `GroupOrderSchema` is the public response shape rendered by the
 *   production client's `/group-orders` page. `pricePerUnit` is an
 *   integer string to match the Order.amount pattern used elsewhere
 *   in the API; `currentQuantity` and `targetQuantity` are integers.
 * - `JoinGroupOrderParamsSchema` validates the `:id` path segment of
 *   `POST /group-orders/:id/join` as a UUID so a malformed id is
 *   rejected before touching the database.
 */

export const GroupOrderStatusSchema = z.enum(['OPEN', 'EXPIRED', 'COMPLETED']);

export const GroupOrderSchema = z.object({
  id: z.string().uuid(),
  productName: z.string().min(1),
  pricePerUnit: z.string().min(1),
  targetQuantity: z.number().int().positive(),
  currentQuantity: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
  status: GroupOrderStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const JoinGroupOrderParamsSchema = z.object({
  id: uuidParam,
});

export const JoinGroupOrderResponseSchema = GroupOrderSchema.extend({
  joined: z.boolean(),
});

export type GroupOrder = z.infer<typeof GroupOrderSchema>;
export type JoinGroupOrderResponse = z.infer<typeof JoinGroupOrderResponseSchema>;
