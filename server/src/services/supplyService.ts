import { Prisma } from '@prisma/client';
import { prisma } from "../config/database.js";
import { ApiError } from "../http/errors.js";
import { z } from "zod";

const supplyBodySchema = z.object({
  crop_name: z.string().min(1),
  quantity_available: z.string().min(1),
  unit: z.string().optional(),
  price_per_unit: z.string().optional(),
  currency: z.string().optional(),
  available_from: z.coerce.date().optional(),
  available_until: z.coerce.date().optional(),
  notes: z.string().optional(),
  farmer_wallet: z.string().optional(),
});

async function assertFarmerProfile(wallet: string): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { wallet_address: wallet },
    select: { role: true },
  });
  if (!profile) {
    throw new ApiError(
      404,
      "Not Found",
      "Create a farmer profile before posting supply.",
      "https://cylos.io/errors/not-found",
    );
  }
  if (profile.role !== "FARMER") {
    throw new ApiError(
      403,
      "Forbidden",
      "Only farmers can declare supply.",
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

export async function listFarmerSupplies(params: {
  farmerWallet?: string;
  cropName?: string;
  minPrice?: string;
  maxPrice?: string;
  page?: string;
  pageSize?: string;
}): Promise<{ page: number; page_size: number; total: number; totalPages: number; items: unknown[] }> {
  const page = parsePage(params.page, 1);
  const pageSize = Math.min(parsePage(params.pageSize, 20), 100);
  const where: Prisma.FarmerSupplyWhereInput = {};

  if (params.farmerWallet) {
    where.farmerWallet = params.farmerWallet.toLowerCase();
  }
  if (params.cropName) {
    where.cropName = { contains: params.cropName, mode: 'insensitive' };
  }

  const [total, items] = await prisma.$transaction([
    prisma.farmerSupply.count({ where }),
    prisma.farmerSupply.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
  ]);

  return { page, page_size: pageSize, total, totalPages: Math.ceil(total / pageSize), items };
}

export async function createFarmerSupply(farmerWallet: string, body: unknown) {
  const parsed = supplyBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "Bad Request", parsed.error.message, "https://cylos.io/errors/validation");
  }
  if (parsed.data.farmer_wallet !== undefined && parsed.data.farmer_wallet.toLowerCase() !== farmerWallet) {
    throw new ApiError(403, "Forbidden", "farmer_wallet must match x-wallet-address", "https://cylos.io/errors/forbidden");
  }

  await assertFarmerProfile(farmerWallet);

  return prisma.farmerSupply.create({
    data: {
      farmerWallet,
      cropName: parsed.data.crop_name,
      quantityAvailable: parsed.data.quantity_available,
      unit: parsed.data.unit,
      pricePerUnit: parsed.data.price_per_unit,
      currency: parsed.data.currency,
      availableFrom: parsed.data.available_from,
      availableUntil: parsed.data.available_until,
      notes: parsed.data.notes,
    },
  });
}
