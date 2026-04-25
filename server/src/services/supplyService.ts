import { Prisma } from "@prisma/client";
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
  const rows = await prisma.$queryRaw<{ role: string }[]>(
    Prisma.sql`SELECT role::text AS role FROM "Profile" WHERE wallet_address = ${wallet} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "Not Found",
      "Create a farmer profile before posting supply.",
      "https://cylos.io/errors/not-found",
    );
  }
  if (row.role !== "FARMER") {
    throw new ApiError(
      403,
      "Forbidden",
      "Only farmers can declare supply.",
      "https://cylos.io/errors/forbidden",
    );
  }
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
