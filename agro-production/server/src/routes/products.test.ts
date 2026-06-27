import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { Request, Response } from "express";

// Mock dependencies before importing app
vi.mock("../db/client.js", () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    campaign: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
  connectDB: vi.fn(),
}));

vi.mock("../services/wsServer.js", () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
}));

vi.mock("../middleware/walletAuth.js", () => ({
  requireWallet: (req: Request & { walletAddress?: string }, res: Response, next: Function) => {
    const header = req.header("x-wallet-address");
    if (!header) {
      res.status(401).json({ message: "Missing x-wallet-address header." });
      return;
    }
    (req as any).walletAddress = header;
    next();
  },
}));

vi.mock("../middleware/rateLimit.js", () => ({
  writeLimiter: (_req: Request, _res: Response, next: Function) => {
    next();
  },
  defaultLimiter: (_req: Request, _res: Response, next: Function) => {
    next();
  },
}));

import app from "../app.js";
import { prisma } from "../db/client.js";

// Test constants
const FARMER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BUYER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const CAMPAIGN_UUID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PRODUCT_UUID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const NOW = new Date().toISOString();

const mockProduct = {
  id: PRODUCT_UUID,
  name: "Organic Wheat",
  description: "High-quality organic wheat",
  imageUrl: "https://example.com/wheat.jpg",
  priceTokens: BigInt("1000000000"),
  campaignId: CAMPAIGN_UUID,
  inventoryCount: 100,
  category: "GRAINS",
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const mockCampaign = {
  id: CAMPAIGN_UUID,
  onChainId: "1",
  farmerAddress: FARMER,
  tokenAddress: "GTOKEN",
  targetAmount: "10000",
  totalRaised: "5000",
  totalRevenue: "0",
  status: "IN_PRODUCTION",
  createdAt: NOW,
  updatedAt: NOW,
  deadline: new Date(Date.now() + 86400000).toISOString(),
};

describe("Products API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/products", () => {
    it("should return paginated products list", async () => {
      (prisma.product.findMany as any).mockResolvedValue([mockProduct]);
      (prisma.product.count as any).mockResolvedValue(1);

      const res = await request(app)
        .get("/api/v1/products?page=1&limit=20")
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.meta.page).toBe(1);
    });

    it("should filter by category", async () => {
      (prisma.product.findMany as any).mockResolvedValue([mockProduct]);
      (prisma.product.count as any).mockResolvedValue(1);

      await request(app)
        .get("/api/v1/products?category=GRAINS")
        .expect(200);

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: "GRAINS" }),
        }),
      );
    });

    it("should filter by campaignId", async () => {
      (prisma.product.findMany as any).mockResolvedValue([mockProduct]);
      (prisma.product.count as any).mockResolvedValue(1);

      await request(app)
        .get(`/api/v1/products?campaignId=${CAMPAIGN_UUID}`)
        .expect(200);

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ campaignId: CAMPAIGN_UUID }),
        }),
      );
    });

    it("should filter by price range", async () => {
      (prisma.product.findMany as any).mockResolvedValue([mockProduct]);
      (prisma.product.count as any).mockResolvedValue(1);

      await request(app)
        .get(`/api/v1/products?priceMin=100000000&priceMax=2000000000`)
        .expect(200);

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            priceTokens: expect.objectContaining({
              gte: BigInt("100000000"),
              lte: BigInt("2000000000"),
            }),
          }),
        }),
      );
    });

    it("should filter by isActive", async () => {
      (prisma.product.findMany as any).mockResolvedValue([]);
      (prisma.product.count as any).mockResolvedValue(0);

      await request(app)
        .get("/api/v1/products?isActive=true")
        .expect(200);

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it("should return correct pagination slice", async () => {
      (prisma.product.findMany as any).mockResolvedValue([mockProduct]);
      (prisma.product.count as any).mockResolvedValue(50);

      const res = await request(app)
        .get("/api/v1/products?page=2&limit=10")
        .expect(200);

      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.limit).toBe(10);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe("GET /api/v1/products/:id", () => {
    it("should return product detail with campaign", async () => {
      (prisma.product.findUnique as any).mockResolvedValue({
        ...mockProduct,
        campaign: {
          id: CAMPAIGN_UUID,
          onChainId: "1",
          farmerAddress: FARMER,
          status: "IN_PRODUCTION",
        },
      });

      const res = await request(app)
        .get(`/api/v1/products/${PRODUCT_UUID}`)
        .expect(200);

      expect(res.body.name).toBe("Organic Wheat");
      expect(res.body.campaign).toBeDefined();
    });

    it("should return product without campaign if not linked", async () => {
      (prisma.product.findUnique as any).mockResolvedValue({
        ...mockProduct,
        campaignId: null,
        campaign: null,
      });

      const res = await request(app)
        .get(`/api/v1/products/${PRODUCT_UUID}`)
        .expect(200);

      expect(res.body.campaign).toBeNull();
    });

    it("should return 404 for unknown product", async () => {
      const unknownUUID = "ffffffff-ffff-4fff-ffff-ffffffffffff";
      (prisma.product.findUnique as any).mockResolvedValue(null);

      await request(app)
        .get(`/api/v1/products/${unknownUUID}`)
        .expect(404);
    });
  });

  describe("POST /api/v1/products", () => {
    it("should require x-wallet-address header", async () => {
      await request(app)
        .post("/api/v1/products")
        .send({
          name: "Organic Wheat",
          description: "High-quality organic wheat",
          priceTokens: "1000000000",
          inventoryCount: 100,
          category: "GRAINS",
        })
        .expect(401);
    });

    it("should forbid non-farmers from creating products (403)", async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ role: "BUYER" });

      await request(app)
        .post("/api/v1/products")
        .set("x-wallet-address", BUYER)
        .send({
          name: "Organic Wheat",
          description: "High-quality organic wheat",
          priceTokens: "1000000000",
          inventoryCount: 100,
          category: "GRAINS",
        })
        .expect(403);
    });

    it("should allow farmer to create product", async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ role: "FARMER" });
      (prisma.product.create as any).mockResolvedValue(mockProduct);

      const res = await request(app)
        .post("/api/v1/products")
        .set("x-wallet-address", FARMER)
        .send({
          name: "Organic Wheat",
          description: "High-quality organic wheat",
          priceTokens: "1000000000",
          inventoryCount: 100,
          category: "GRAINS",
        })
        .expect(201);

      expect(res.body.name).toBe("Organic Wheat");
      expect(prisma.product.create).toHaveBeenCalled();
    });

    it("should validate farmer owns the campaign", async () => {
      const otherFarmer = "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
      (prisma.user.findUnique as any).mockResolvedValue({ role: "FARMER" });
      (prisma.campaign.findUnique as any).mockResolvedValue({
        ...mockCampaign,
        farmerAddress: otherFarmer,
      });

      await request(app)
        .post("/api/v1/products")
        .set("x-wallet-address", FARMER)
        .send({
          name: "Organic Wheat",
          description: "High-quality organic wheat",
          priceTokens: "1000000000",
          inventoryCount: 100,
          category: "GRAINS",
          campaignId: CAMPAIGN_UUID,
        })
        .expect(403);
    });

    it("should return 404 for unknown campaign", async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ role: "FARMER" });
      (prisma.campaign.findUnique as any).mockResolvedValue(null);

      const unknownCampaignId = "ffffffff-ffff-4fff-ffff-ffffffffffff";
      await request(app)
        .post("/api/v1/products")
        .set("x-wallet-address", FARMER)
        .send({
          name: "Organic Wheat",
          description: "High-quality organic wheat",
          priceTokens: "1000000000",
          inventoryCount: 100,
          category: "GRAINS",
          campaignId: unknownCampaignId,
        })
        .expect(404);
    });
  });

  describe("PATCH /api/v1/products/:id", () => {
    it("should require x-wallet-address header", async () => {
      await request(app)
        .patch(`/api/v1/products/${PRODUCT_UUID}`)
        .send({ name: "Updated Name" })
        .expect(401);
    });

    it("should allow farmer to update their product", async () => {
      (prisma.product.findUnique as any).mockResolvedValue({
        ...mockProduct,
        campaign: { farmerAddress: FARMER },
      });
      (prisma.user.findUnique as any).mockResolvedValue({ role: "FARMER" });
      (prisma.product.update as any).mockResolvedValue({
        ...mockProduct,
        name: "Updated Wheat",
      });

      const res = await request(app)
        .patch(`/api/v1/products/${PRODUCT_UUID}`)
        .set("x-wallet-address", FARMER)
        .send({ name: "Updated Wheat" })
        .expect(200);

      expect(res.body.name).toBe("Updated Wheat");
      expect(prisma.product.update).toHaveBeenCalled();
    });

    it("should forbid non-owner from updating product (403)", async () => {
      const otherFarmer = "GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
      (prisma.product.findUnique as any).mockResolvedValue({
        ...mockProduct,
        campaign: { farmerAddress: otherFarmer },
      });
      (prisma.user.findUnique as any).mockResolvedValue({ role: "FARMER" });

      await request(app)
        .patch(`/api/v1/products/${PRODUCT_UUID}`)
        .set("x-wallet-address", FARMER)
        .send({ name: "Updated Wheat" })
        .expect(403);
    });

    it("should return 404 for unknown product", async () => {
      const unknownUUID = "ffffffff-ffff-4fff-ffff-ffffffffffff";
      (prisma.product.findUnique as any).mockResolvedValue(null);

      await request(app)
        .patch(`/api/v1/products/${unknownUUID}`)
        .set("x-wallet-address", FARMER)
        .send({ name: "Updated Wheat" })
        .expect(404);
    });

    it("should handle partial updates", async () => {
      (prisma.product.findUnique as any).mockResolvedValue({
        ...mockProduct,
        campaign: { farmerAddress: FARMER },
      });
      (prisma.user.findUnique as any).mockResolvedValue({ role: "FARMER" });
      (prisma.product.update as any).mockResolvedValue({
        ...mockProduct,
        priceTokens: BigInt("2000000000"),
      });

      await request(app)
        .patch(`/api/v1/products/${PRODUCT_UUID}`)
        .set("x-wallet-address", FARMER)
        .send({ priceTokens: "2000000000" })
        .expect(200);

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { priceTokens: BigInt("2000000000") },
        }),
      );
    });
  });
});
