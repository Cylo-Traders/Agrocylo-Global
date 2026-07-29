import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../app.js";
import { prisma } from "../config/database.js";

vi.mock("../config/database.js", () => ({
  prisma: {
    cropPlan: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

describe("CropPlan routes (Issue #658)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("POST /crop-plans creates a crop plan when valid dates are provided", async () => {
    const mockPlan = {
      id: "cp-123",
      farmerWallet: "G1234567890",
      cropName: "Cassava",
      plantedDate: new Date("2026-01-01"),
      expectedHarvestStart: new Date("2026-06-01"),
      expectedHarvestEnd: new Date("2026-06-30"),
      expectedVolume: 500,
      unit: "kg",
      region: "South-East",
      reminderDaysBefore: 7,
      reminderSent: false,
    };

    vi.mocked(prisma.cropPlan.create).mockResolvedValue(mockPlan as any);

    const res = await request(app)
      .post("/crop-plans")
      .send({
        farmerWallet: "G1234567890",
        cropName: "Cassava",
        plantedDate: "2026-01-01",
        expectedHarvestStart: "2026-06-01",
        expectedHarvestEnd: "2026-06-30",
        expectedVolume: 500,
        unit: "kg",
        region: "South-East",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("cp-123");
    expect(res.body.cropName).toBe("Cassava");
  });

  it("POST /crop-plans returns 400 when plantedDate is after expectedHarvestStart", async () => {
    const res = await request(app)
      .post("/crop-plans")
      .send({
        farmerWallet: "G1234567890",
        cropName: "Maize",
        plantedDate: "2026-07-01",
        expectedHarvestStart: "2026-06-01",
        expectedHarvestEnd: "2026-06-30",
      });

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("Planted date cannot be after expected harvest start date");
  });

  it("GET /crop-plans/aggregate returns non-PII aggregated harvest volume for buyers", async () => {
    vi.mocked(prisma.cropPlan.findMany).mockResolvedValue([
      {
        cropName: "Maize",
        expectedVolume: 1000,
        unit: "kg",
        region: "North",
        expectedHarvestStart: new Date("2026-08-01"),
        expectedHarvestEnd: new Date("2026-08-31"),
      },
      {
        cropName: "Maize",
        expectedVolume: 500,
        unit: "kg",
        region: "North",
        expectedHarvestStart: new Date("2026-08-15"),
        expectedHarvestEnd: new Date("2026-08-31"),
      },
    ] as any);

    const res = await request(app)
      .get("/crop-plans/aggregate?region=North&month=8&year=2026");

    expect(res.status).toBe(200);
    expect(res.body.region).toBe("North");
    expect(res.body.aggregates).toHaveLength(1);
    expect(res.body.aggregates[0].totalExpectedVolume).toBe(1500);
    expect(res.body.aggregates[0].planCount).toBe(2);
  });

  it("POST /crop-plans/:id/reminder triggers harvest reminder when N days before harvest", async () => {
    const harvestDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
    vi.mocked(prisma.cropPlan.findUnique).mockResolvedValue({
      id: "cp-123",
      farmerWallet: "G1234567890",
      cropName: "Yams",
      expectedHarvestStart: harvestDate,
      reminderDaysBefore: 7,
      reminderSent: false,
    } as any);

    vi.mocked(prisma.cropPlan.update).mockResolvedValue({} as any);
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);

    const res = await request(app).post("/crop-plans/cp-123/reminder");

    expect(res.status).toBe(200);
    expect(res.body.reminderTriggered).toBe(true);
    expect(prisma.cropPlan.update).toHaveBeenCalledWith({
      where: { id: "cp-123" },
      data: { reminderSent: true },
    });
  });
});
