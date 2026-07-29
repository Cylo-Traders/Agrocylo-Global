import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../app.js";
import { prisma } from "../config/database.js";

vi.mock("../config/database.js", () => ({
  prisma: {
    equipmentListing: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    equipmentRental: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("Equipment Marketplace routes (Issue #657)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("POST /equipment/listings creates a seed or tool listing", async () => {
    const mockListing = {
      id: "el-1",
      ownerWallet: "G999999999",
      title: "Tractor Rental",
      listingType: "EQUIPMENT_RENTAL",
      pricePerUnit: "50.00",
      depositAmount: "100.00",
      currency: "XLM",
      unit: "day",
      isAvailable: true,
    };

    vi.mocked(prisma.equipmentListing.create).mockResolvedValue(mockListing as any);

    const res = await request(app)
      .post("/equipment/listings")
      .send({
        ownerWallet: "G999999999",
        title: "Tractor Rental",
        listingType: "EQUIPMENT_RENTAL",
        pricePerUnit: 50.0,
        depositAmount: 100.0,
        currency: "XLM",
        unit: "day",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("el-1");
    expect(res.body.listingType).toBe("EQUIPMENT_RENTAL");
  });

  it("POST /equipment/rent creates rental with deposit step", async () => {
    vi.mocked(prisma.equipmentListing.findUnique).mockResolvedValue({
      id: "el-1",
      isAvailable: true,
      depositAmount: 100.0,
    } as any);

    const mockRental = {
      id: "er-1",
      listingId: "el-1",
      renterWallet: "G888888888",
      startDate: new Date("2026-08-01"),
      endDate: new Date("2026-08-05"),
      status: "ACTIVE",
      depositAmount: 100.0,
      depositRefunded: false,
    };

    vi.mocked(prisma.equipmentRental.create).mockResolvedValue(mockRental as any);

    const res = await request(app)
      .post("/equipment/rent")
      .send({
        listingId: "el-1",
        renterWallet: "G888888888",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.depositAmount).toBe(100.0);
  });

  it("POST /equipment/rentals/:id/return confirms return and triggers deposit refund", async () => {
    vi.mocked(prisma.equipmentRental.findUnique).mockResolvedValue({
      id: "er-1",
      status: "ACTIVE",
      depositAmount: 100.0,
      listing: { currency: "XLM" },
    } as any);

    vi.mocked(prisma.equipmentRental.update).mockResolvedValue({
      id: "er-1",
      status: "RETURNED",
      depositRefunded: true,
    } as any);

    const res = await request(app)
      .post("/equipment/rentals/er-1/return")
      .send({ confirmCondition: true });

    expect(res.status).toBe(200);
    expect(res.body.rental.status).toBe("RETURNED");
    expect(res.body.rental.depositRefunded).toBe(true);
    expect(res.body.message).toContain("refunded");
  });
});
