/**
 * Exercises the REAL generated Prisma client against a live database
 * (see .github/workflows/ci.yml, "server-integration" job) instead of the
 * hand-mocked prisma used by the route unit tests. Catches schema/migration
 * drift — e.g. a model referenced by routes but never migrated — that
 * mocked tests cannot detect (Issue #684).
 */
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./config/database.js";

describe("Prisma schema/migration parity (Issue #684)", () => {
  const cropPlanIds: string[] = [];
  const listingIds: string[] = [];

  afterAll(async () => {
    await prisma.equipmentListing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.cropPlan.deleteMany({ where: { id: { in: cropPlanIds } } });
    await prisma.$disconnect();
  });

  it("creates and reads a CropPlan", async () => {
    const farmerWallet = `GTEST${randomUUID().replace(/-/g, "").slice(0, 50).toUpperCase()}`;
    const created = await prisma.cropPlan.create({
      data: {
        farmerWallet,
        cropName: "Cassava",
        plantedDate: new Date("2026-01-01"),
        expectedHarvestStart: new Date("2026-06-01"),
        expectedHarvestEnd: new Date("2026-06-30"),
        expectedVolume: 500,
        unit: "kg",
        region: "South-East",
      },
    });
    cropPlanIds.push(created.id);

    const found = await prisma.cropPlan.findUnique({ where: { id: created.id } });
    expect(found?.farmerWallet).toBe(farmerWallet);
  });

  it("creates an EquipmentListing, rents it, and cascades delete to EquipmentRental", async () => {
    const ownerWallet = `GTEST${randomUUID().replace(/-/g, "").slice(0, 50).toUpperCase()}`;
    const listing = await prisma.equipmentListing.create({
      data: {
        ownerWallet,
        title: "Tractor",
        listingType: "EQUIPMENT_RENTAL",
        pricePerUnit: "10.00",
        depositAmount: "100.00",
        currency: "USDC",
        unit: "day",
      },
    });
    listingIds.push(listing.id);

    const rental = await prisma.equipmentRental.create({
      data: {
        listingId: listing.id,
        renterWallet: `GTEST${randomUUID().replace(/-/g, "").slice(0, 50).toUpperCase()}`,
        startDate: new Date("2026-08-01"),
        endDate: new Date("2026-08-05"),
        depositAmount: listing.depositAmount,
      },
    });

    const withRentals = await prisma.equipmentListing.findUnique({
      where: { id: listing.id },
      include: { rentals: true },
    });
    expect(withRentals?.rentals.map((r) => r.id)).toContain(rental.id);

    await prisma.equipmentListing.delete({ where: { id: listing.id } });
    const orphanRental = await prisma.equipmentRental.findUnique({ where: { id: rental.id } });
    expect(orphanRental).toBeNull();
  });
});
