import { z } from 'zod';

export const ProductCategorySchema = z.enum([
  'GRAINS',
  'VEGETABLES',
  'FRUITS',
  'LIVESTOCK',
  'DAIRY',
  'OTHER',
]);

export const ProductCampaignSchema = z.object({
  id: z.string(),
  onChainId: z.string(),
  farmerAddress: z.string(),
  status: z.string(),
});

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: ProductCategorySchema,
  pricePerUnit: z.string(),
  amountUnit: z.literal('stroops'),
  currency: z.enum(['XLM', 'USDC']),
  unit: z.string(),
  quantity: z.number(),
  location: z.string().nullable(),
  farmerAddress: z.string(),
  campaignId: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  isActive: z.boolean(),
  isSellable: z.boolean(),
  campaign: ProductCampaignSchema.nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProductListResponseSchema = z.object({
  data: z.array(ProductSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    serviceVersion: z.string(),
    readiness: z.enum(['ready', 'degraded']),
  }),
});

export const ProductQuerySchema = z.object({
  category: ProductCategorySchema.optional(),
  campaignId: z.string().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  location: z.string().trim().min(1).optional(),
  minPrice: z.string().regex(/^\d+$/).optional(),
  maxPrice: z.string().regex(/^\d+$/).optional(),
  priceMin: z.string().regex(/^\d+$/).optional(),
  priceMax: z.string().regex(/^\d+$/).optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export const ProductIdParamSchema = z.object({ id: z.string() });
