import { Prisma } from '@prisma/client';
import { prisma } from "../config/database.js";
import { ApiError } from "../http/errors.js";
import { z } from "zod";

const demandBodySchema = z.object({
  crop_name: z.string().min(1),
  quantity_wanted: z.string().optional(),
  unit: z.string().optional(),
  max_price_per_unit: z.string().optional(),
  currency: z.string().optional(),
  region: z.string().optional(),
  notes: z.string().optional(),
  needed_by: z.coerce.date().optional(),
  buyer_wallet: z.string().optional(),
});

async function assertBuyerProfile(wallet: string): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { wallet_address: wallet },
    select: { role: true },
  });
  if (!profile) {
    throw new ApiError(
      404,
      "Not Found",
      "Create a buyer profile before posting demand.",
      "https://cylos.io/errors/not-found",
    );
  }
  if (profile.role !== "BUYER") {
    throw new ApiError(
      403,
      "Forbidden",
      "Only buyers can post demand.",
      "https://cylos.io/errors/forbidden",
    );
  }
}

function parsePage(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

function decimalFilter(value: string | undefined): Prisma.Decimal | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Prisma.Decimal(value);
}

export async function listBuyerDemands(params: {
  buyerWallet?: string;
  cropName?: string;
  region?: string;
  minPrice?: string;
  maxPrice?: string;
  page?: string;
  pageSize?: string;
}): Promise<{ page: number; page_size: number; total: number; totalPages: number; items: unknown[] }> {
  const page = parsePage(params.page, 1);
  const pageSize = Math.min(parsePage(params.pageSize, 20), 100);
  const where: Prisma.BuyerDemandWhereInput = {};

  if (params.buyerWallet) {
    where.buyerWallet = params.buyerWallet.toLowerCase();
  }
  if (params.cropName) {
    where.cropName = { contains: params.cropName, mode: 'insensitive' };
  }
  if (params.region) {
    where.region = { contains: params.region, mode: 'insensitive' };
  }

  const [total, items] = await prisma.$transaction([
    prisma.buyerDemand.count({ where }),
    prisma.buyerDemand.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
  ]);

  return { page, page_size: pageSize, total, totalPages: Math.ceil(total / pageSize), items };
}

export async function createBuyerDemand(buyerWallet: string, body: unknown) {
  const parsed = demandBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "Bad Request", parsed.error.message, "https://cylos.io/errors/validation");
  }
  if (parsed.data.buyer_wallet !== undefined && parsed.data.buyer_wallet.toLowerCase() !== buyerWallet) {
    throw new ApiError(403, "Forbidden", "buyer_wallet must match x-wallet-address", "https://cylos.io/errors/forbidden");
  }

  await assertBuyerProfile(buyerWallet);

  return prisma.buyerDemand.create({
    data: {
      buyerWallet,
      cropName: parsed.data.crop_name,
      quantityWanted: parsed.data.quantity_wanted,
      unit: parsed.data.unit,
      maxPricePerUnit: parsed.data.max_price_per_unit,
      currency: parsed.data.currency,
      region: parsed.data.region,
      notes: parsed.data.notes,
      neededBy: parsed.data.needed_by,
    },
  });
}
