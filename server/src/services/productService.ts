import { Prisma } from '@prisma/client';
import type { Product } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { wsManager } from './wsManager.js';

export interface ProductWriteInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  price_per_unit?: string;
  currency?: 'STRK' | 'USDC';
  unit?: string;
  stock_quantity?: string | null;
  location?: string;
  is_available?: boolean;
}

export type ProductDto = {
  id: string;
  [key: string]: unknown;
};

function parsePage(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    farmer_wallet: product.farmerWallet,
    name: product.name,
    description: product.description,
    category: product.category,
    price_per_unit: product.pricePerUnit.toString(),
    currency: product.currency,
    unit: product.unit,
    stock_quantity: product.stockQuantity?.toString() ?? null,
    location: product.location,
    image_url: product.imageUrl,
    is_available: product.isAvailable,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

function decimalFilter(value: string | undefined): Prisma.Decimal | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Prisma.Decimal(value);
}

export async function listProducts(params: {
  farmer?: string;
  category?: string;
  search?: string;
  location?: string;
  minPrice?: string;
  maxPrice?: string;
  page?: string;
  pageSize?: string;
  includeUnavailable?: boolean;
}): Promise<{ page: number; page_size: number; total: number; totalPages: number; items: ProductDto[] }> {
  const page = parsePage(params.page, 1);
  const pageSize = Math.min(parsePage(params.pageSize, 20), 100);
  const where: Prisma.ProductWhereInput = params.includeUnavailable ? {} : { isAvailable: true };

  if (params.farmer) {
    where.farmerWallet = params.farmer.toLowerCase();
  }
  if (params.category) {
    where.category = params.category;
  }
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { description: { contains: params.search, mode: 'insensitive' } },
      { category: { contains: params.search, mode: 'insensitive' } },
    ];
  }
  if (params.location) {
    where.location = { contains: params.location, mode: 'insensitive' };
  }
  const minPrice = decimalFilter(params.minPrice);
  const maxPrice = decimalFilter(params.maxPrice);
  if (minPrice || maxPrice) {
    where.pricePerUnit = {
      ...(minPrice ? { gte: minPrice } : {}),
      ...(maxPrice ? { lte: maxPrice } : {}),
    };
  }

  const [total, products] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
  ]);

  return {
    page,
    page_size: pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    items: products.map(toProductDto),
  };
}

async function emitProductEvent(event: string, product: unknown) {
  wsManager.broadcast(event, product);
}

export async function getProductById(productId: string): Promise<ProductDto> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ApiError(404, 'Not Found', 'Product not found');
  return toProductDto(product);
}

export async function createProduct(farmerWallet: string, input: ProductWriteInput): Promise<ProductDto> {
  if (!input.name || !input.price_per_unit || !input.currency || !input.unit) {
    throw new ApiError(400, 'Bad Request', 'name, price_per_unit, currency, and unit are required');
  }

  const product = await prisma.product.create({
    data: {
      farmerWallet: farmerWallet.toLowerCase(),
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      pricePerUnit: new Prisma.Decimal(input.price_per_unit),
      currency: input.currency,
      unit: input.unit,
      stockQuantity: input.stock_quantity ? new Prisma.Decimal(input.stock_quantity) : null,
      location: input.location ?? null,
      isAvailable: input.is_available ?? true,
    },
  });
  const result = toProductDto(product);
  emitProductEvent('product:created', result);
  return result;
}

export async function updateProduct(productId: string, farmerWallet: string, input: ProductWriteInput): Promise<ProductDto> {
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) throw new ApiError(404, 'Not Found', 'Product not found');
  if (existing.farmerWallet.toLowerCase() !== farmerWallet.toLowerCase()) {
    throw new ApiError(403, 'Forbidden', 'You do not own this product');
  }

  const data: Prisma.ProductUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category;
  if (input.price_per_unit !== undefined) data.pricePerUnit = new Prisma.Decimal(input.price_per_unit);
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.unit !== undefined) data.unit = input.unit;
  if (input.stock_quantity !== undefined) {
    data.stockQuantity = input.stock_quantity === null ? null : new Prisma.Decimal(input.stock_quantity);
  }
  if (input.location !== undefined) data.location = input.location;
  if (input.is_available !== undefined) data.isAvailable = input.is_available;

  if (Object.keys(data).length === 0) throw new ApiError(400, 'Bad Request', 'No fields provided to update');
  const product = await prisma.product.update({ where: { id: productId }, data });
  const result = toProductDto(product);
  emitProductEvent('product:updated', result);
  return result;
}

export async function softDeleteProduct(productId: string, farmerWallet: string) {
  const result = await updateProduct(productId, farmerWallet, { is_available: false });
  emitProductEvent('product:deleted', result);
  return result;
}
