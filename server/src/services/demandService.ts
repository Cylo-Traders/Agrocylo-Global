import { Prisma } from "@prisma/client";
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
  const rows = await prisma.$queryRaw<{ role: string }[]>(
    Prisma.sql`SELECT role::text AS role FROM "Profile" WHERE wallet_address = ${wallet} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "Not Found",
      "Create a buyer profile before posting demand.",
      "https://cylos.io/errors/not-found",
    );
  }
  if (row.role !== "BUYER") {
    throw new ApiError(
      403,
      "Forbidden",
      "Only buyers can post demand.",
      "https://cylos.io/errors/forbidden",
    );
  }
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
