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

vi.mock("../middleware/walletAuth.js", () => ({
  requireWallet: (req: any, res: any, next: any) => {
    const wallet = req.headers["x-wallet-address"];
    if (!wallet) {
      res.status(401).json({ message: "Missing wallet" });
      return;
    }
    req.walletAddress = wallet;
    next();
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
      .set("x-wallet-address", "G999999999")
      .send({
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
    expect(prisma.equipmentListing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerWallet: "G999999999" }),
      }),
    );
  });

  it("POST /equipment/listings rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/equipment/listings")
      .send({
        title: "Tractor",
        listingType: "TOOL",
        pricePerUnit: 50.0,
        currency: "XLM",
        unit: "day",
      });

    expect(res.status).toBe(401);
  });

  it("POST /equipment/listings rejects cross-wallet spoofing (ownerWallet in body ignored)", async () => {
    const mockListing = {
      id: "el-1",
      ownerWallet: "G999999999",
      title: "Tractor",
      listingType: "TOOL",
      pricePerUnit: "50.00",
      currency: "XLM",
      unit: "day",
      isAvailable: true,
    };

    vi.mocked(prisma.equipmentListing.create).mockResolvedValue(mockListing as any);

    await request(app)
      .post("/equipment/listings")
      .set("x-wallet-address", "G999999999")
      .send({
        ownerWallet: "GEVILHACKER", // spoofed – must be ignored
        title: "Tractor",
        listingType: "TOOL",
        pricePerUnit: 50.0,
        currency: "XLM",
        unit: "day",
      });

    // The ownerWallet used in create must be the authenticated one, not the spoofed body value
    expect(prisma.equipmentListing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerWallet: "G999999999" }),
      }),
    );
    expect(prisma.equipmentListing.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerWallet: "GEVILHACKER" }),
      }),
    );
  });

  it("POST /equipment/rent creates rental with deposit step", async () => {
    vi.mocked(prisma.equipmentListing.findUnique).mockResolvedValue({
      id: "el-1",
      ownerWallet: "G999999999",
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
      .set("x-wallet-address", "G888888888")
      .send({
        listingId: "el-1",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.depositAmount).toBe(100.0);
  });

  it("POST /equipment/rent rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/equipment/rent")
      .send({
        listingId: "el-1",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
      });

    expect(res.status).toBe(401);
  });

  it("POST /equipment/rent rejects cross-wallet spoofing (renterWallet in body ignored)", async () => {
    vi.mocked(prisma.equipmentListing.findUnique).mockResolvedValue({
      id: "el-1",
      ownerWallet: "G999999999",
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

    await request(app)
      .post("/equipment/rent")
      .set("x-wallet-address", "G888888888")
      .send({
        listingId: "el-1",
        renterWallet: "GEVILHACKER", // spoofed – must be ignored
        startDate: "2026-08-01",
        endDate: "2026-08-05",
      });

    expect(prisma.equipmentRental.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ renterWallet: "G888888888" }),
      }),
    );
    expect(prisma.equipmentRental.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ renterWallet: "GEVILHACKER" }),
      }),
    );
  });

  it("POST /equipment/rentals/:id/return - owner can confirm return and refund deposit", async () => {
    vi.mocked(prisma.equipmentRental.findUnique).mockResolvedValue({
      id: "er-1",
      status: "ACTIVE",
      renterWallet: "G888888888",
      depositAmount: 100.0,
      listing: { ownerWallet: "G999999999", currency: "XLM" },
    } as any);

    vi.mocked(prisma.equipmentRental.update).mockResolvedValue({
      id: "er-1",
      status: "RETURNED",
      depositRefunded: true,
    } as any);

    const res = await request(app)
      .post("/equipment/rentals/er-1/return")
      .set("x-wallet-address", "G999999999")
      .send({ confirmCondition: true });

    expect(res.status).toBe(200);
    expect(res.body.rental.status).toBe("RETURNED");
    expect(res.body.rental.depositRefunded).toBe(true);
    expect(res.body.message).toContain("refunded");
  });

  it("POST /equipment/rentals/:id/return - renter can return but cannot refund deposit", async () => {
    vi.mocked(prisma.equipmentRental.findUnique).mockResolvedValue({
      id: "er-1",
      status: "ACTIVE",
      renterWallet: "G888888888",
      depositAmount: 100.0,
      listing: { ownerWallet: "G999999999", currency: "XLM" },
    } as any);

    vi.mocked(prisma.equipmentRental.update).mockResolvedValue({
      id: "er-1",
      status: "RETURNED",
      depositRefunded: false,
    } as any);

    const res = await request(app)
      .post("/equipment/rentals/er-1/return")
      .set("x-wallet-address", "G888888888")
      .send({ confirmCondition: true });

    expect(res.status).toBe(200);
    expect(res.body.rental.status).toBe("RETURNED");
    expect(res.body.rental.depositRefunded).toBe(false);
    expect(res.body.message).toContain("pending owner inspection");
  });

  it("POST /equipment/rentals/:id/return rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/equipment/rentals/er-1/return")
      .send({ confirmCondition: true });

    expect(res.status).toBe(401);
  });

  it("POST /equipment/rentals/:id/return rejects unauthorised caller (neither renter nor owner)", async () => {
    vi.mocked(prisma.equipmentRental.findUnique).mockResolvedValue({
      id: "er-1",
      status: "ACTIVE",
      renterWallet: "G888888888",
      depositAmount: 100.0,
      listing: { ownerWallet: "G999999999", currency: "XLM" },
    } as any);

    const res = await request(app)
      .post("/equipment/rentals/er-1/return")
      .set("x-wallet-address", "GSTRANGER")
      .send({ confirmCondition: true });

    expect(res.status).toBe(403);
  });
});
