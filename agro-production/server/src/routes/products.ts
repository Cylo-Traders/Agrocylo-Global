import { Router, type Request, type Response } from 'express';
import {
  jsonValidated,
  validateBody,
  validateParams,
  validateResponse,
} from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { problemDetail } from '../middleware/errors.js';
import { prisma } from '../db/client.js';
import {
  ProductListResponseSchema,
  ProductQuerySchema,
  ProductSchema,
  ProductIdParamSchema,
  CreateProductSchema,
  UpdateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from '../schemas/product.js';

const router = Router();

function toProductDto(product: {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceTokens: bigint;
  campaignId: string | null;
  inventoryCount: number;
  category: string;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  campaign?: {
    id: string;
    onChainId: string;
    farmerAddress: string;
    status: string;
  } | null;
}) {
  const quantity = product.inventoryCount;
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    pricePerUnit: product.priceTokens.toString(),
    amountUnit: 'stroops' as const,
    currency: 'XLM' as const,
    unit: 'unit',
    quantity,
    location: null,
    farmerAddress: product.campaign?.farmerAddress ?? '',
    campaignId: product.campaignId,
    imageUrl: product.imageUrl,
    isActive: product.isActive,
    isSellable: product.isActive && quantity > 0,
    campaign: product.campaign
      ? {
          id: product.campaign.id,
          onChainId: product.campaign.onChainId,
          farmerAddress: product.campaign.farmerAddress,
          status: product.campaign.status,
        }
      : null,
    createdAt:
      product.createdAt instanceof Date
        ? product.createdAt.toISOString()
        : product.createdAt,
    updatedAt:
      product.updatedAt instanceof Date
        ? product.updatedAt.toISOString()
        : product.updatedAt,
  };
}

router.get(
  '/products',
  validateResponse(ProductListResponseSchema),
  (req: Request, res: Response, next) => {
    void (async () => {
      const parsed = ProductQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        problemDetail(
          res,
          req,
          400,
          'Invalid Product Filters',
          'Use valid category, location, minPrice, and maxPrice values',
        );
        return;
      }
      const { category, campaignId, isActive, location } = parsed.data;
      const minPrice = parsed.data.minPrice ?? parsed.data.priceMin;
      const maxPrice = parsed.data.maxPrice ?? parsed.data.priceMax;
      const page = Math.max(Number(parsed.data.page ?? '1'), 1);
      const limit = Math.min(
        Math.max(Number(parsed.data.limit ?? '50'), 1),
        100,
      );
      const where = {
        ...(category ? { category } : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(isActive === undefined ? {} : { isActive }),
        ...(location
          ? {
              campaign: {
                farmerAddress: {
                  contains: location,
                  mode: 'insensitive' as const,
                },
              },
            }
          : {}),
        ...(minPrice || maxPrice
          ? {
              priceTokens: {
                ...(minPrice ? { gte: BigInt(minPrice) } : {}),
                ...(maxPrice ? { lte: BigInt(maxPrice) } : {}),
              },
            }
          : {}),
      };
      const [total, products] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          include: { campaign: true },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);
      jsonValidated(res, ProductListResponseSchema, 200, {
        data: products.map(toProductDto),
        meta: {
          total,
          page,
          limit,
          serviceVersion: 'products-v1',
          readiness: 'ready',
        },
      });
    })().catch(next);
  },
);

router.get(
  '/products/:id',
  validateParams(ProductIdParamSchema),
  validateResponse(ProductSchema),
  (req: Request, res: Response, next) => {
    void (async () => {
      const { id } = req.params;
      const product = await prisma.product.findUnique({
        where: { id },
        include: { campaign: true },
      });

      if (!product) {
        problemDetail(
          res,
          req,
          404,
          'Product Not Found',
          `No product with id ${id}`,
        );
        return;
      }

      jsonValidated(res, ProductSchema, 200, toProductDto(product));
    })().catch(next);
  },
);

// GET /campaigns/:id/products — list all products associated with a campaign
router.get(
  '/campaigns/:id/products',
  validateResponse(ProductListResponseSchema),
  (req: Request, res: Response, next) => {
    void (async () => {
      const { id } = req.params;
      // Allow searching by campaign UUID or contract onChainId
      const campaign = await prisma.campaign.findFirst({
        where: { OR: [{ id }, { onChainId: id }] },
      });

      const campaignId = campaign ? campaign.id : id;
      const products = await prisma.product.findMany({
        where: { campaignId },
        include: { campaign: true },
        orderBy: { createdAt: 'desc' },
      });

      jsonValidated(res, ProductListResponseSchema, 200, {
        data: products.map(toProductDto),
        meta: {
          total: products.length,
          page: 1,
          limit: 100,
          serviceVersion: 'products-v1',
          readiness: 'ready',
        },
      });
    })().catch(next);
  },
);

// POST /products — create a new product for a campaign (Issue #1189)
router.post(
  '/products',
  requireWallet,
  writeLimiter,
  validateBody(CreateProductSchema),
  validateResponse(ProductSchema),
  (req: WalletRequest, res: Response, next) => {
    void (async () => {
      const walletAddress = req.walletAddress!;
      const input = req.body as CreateProductInput;

      if (input.campaignId) {
        const campaign = await prisma.campaign.findUnique({
          where: { id: input.campaignId },
        });
        if (!campaign) {
          problemDetail(res, req, 404, 'Campaign Not Found', `No campaign with id ${input.campaignId}`);
          return;
        }
        if (campaign.farmerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          problemDetail(res, req, 403, 'Forbidden', 'You can only create products for your own campaigns');
          return;
        }
      }

      const created = await prisma.product.create({
        data: {
          name: input.name,
          description: input.description ?? '',
          category: input.category,
          priceTokens: BigInt(input.priceTokens),
          inventoryCount: input.inventoryCount,
          campaignId: input.campaignId ?? null,
          imageUrl: input.imageUrl ?? null,
          isActive: input.isActive ?? true,
        },
        include: { campaign: true },
      });

      jsonValidated(res, ProductSchema, 201, toProductDto(created));
    })().catch(next);
  },
);

// PATCH /products/:id — update a product (Issue #1189)
router.patch(
  '/products/:id',
  requireWallet,
  writeLimiter,
  validateParams(ProductIdParamSchema),
  validateBody(UpdateProductSchema),
  validateResponse(ProductSchema),
  (req: WalletRequest, res: Response, next) => {
    void (async () => {
      const { id } = req.params;
      const walletAddress = req.walletAddress!;
      const input = req.body as UpdateProductInput;

      const existing = await prisma.product.findUnique({
        where: { id },
        include: { campaign: true },
      });

      if (!existing) {
        problemDetail(res, req, 404, 'Product Not Found', `No product with id ${id}`);
        return;
      }

      if (existing.campaign && existing.campaign.farmerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        problemDetail(res, req, 403, 'Forbidden', 'You can only update your own products');
        return;
      }

      const updated = await prisma.product.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description ?? '' } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.priceTokens !== undefined ? { priceTokens: BigInt(input.priceTokens) } : {}),
          ...(input.inventoryCount !== undefined ? { inventoryCount: input.inventoryCount } : {}),
          ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        include: { campaign: true },
      });

      jsonValidated(res, ProductSchema, 200, toProductDto(updated));
    })().catch(next);
  },
);

// DELETE /products/:id — deactivate/soft delete a product (Issue #1189)
router.delete(
  '/products/:id',
  requireWallet,
  writeLimiter,
  validateParams(ProductIdParamSchema),
  (req: WalletRequest, res: Response, next) => {
    void (async () => {
      const { id } = req.params;
      const walletAddress = req.walletAddress!;

      const existing = await prisma.product.findUnique({
        where: { id },
        include: { campaign: true },
      });

      if (!existing) {
        problemDetail(res, req, 404, 'Product Not Found', `No product with id ${id}`);
        return;
      }

      if (existing.campaign && existing.campaign.farmerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        problemDetail(res, req, 403, 'Forbidden', 'You can only delete your own products');
        return;
      }

      await prisma.product.update({
        where: { id },
        data: { isActive: false },
      });

      res.status(204).send();
    })().catch(next);
  },
);

export default router;
