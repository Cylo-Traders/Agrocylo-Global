import { Router, type Request, type Response } from 'express';
import {
  jsonValidated,
  validateParams,
  validateResponse,
} from '../middleware/validate.js';
import { problemDetail } from '../middleware/errors.js';
import { prisma } from '../db/client.js';
import {
  ProductListResponseSchema,
  ProductQuerySchema,
  ProductSchema,
  ProductIdParamSchema,
} from '../schemas/product.js';

const router = Router();

function toProductDto(product: {
  id: string;
  name: string;
  description: string;
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

export default router;
