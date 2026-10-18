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
  imageUrl: z.string().nullable().optional(),
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

export const CreateProductSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  description: z.string().nullable().optional(),
  category: ProductCategorySchema,
  priceTokens: z.string().regex(/^\d+$/, 'priceTokens must be a positive numeric string in stroops'),
  inventoryCount: z.number().int().nonnegative('inventoryCount must be non-negative'),
  campaignId: z.string().optional(),
  imageUrl: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const UpdateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: ProductCategorySchema.optional(),
  priceTokens: z.string().regex(/^\d+$/).optional(),
  inventoryCount: z.number().int().nonnegative().optional(),
  campaignId: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
