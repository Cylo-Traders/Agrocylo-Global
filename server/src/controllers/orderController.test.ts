import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../app.js";

// Mock the database config
vi.mock("../config/database.js", () => ({
  prisma: {
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

// We need to import the mocked prisma to set return values
import { prisma } from "../config/database.js";

describe("OrderController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /orders", () => {
    it("should return all orders", async () => {
      const mockOrders = [
        { id: "1", orderIdOnChain: "101", status: "PENDING" },
        { id: "2", orderIdOnChain: "102", status: "COMPLETED" },
      ];
      (prisma.order.findMany as any).mockResolvedValue(mockOrders);

      const response = await request(app).get("/orders");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockOrders);
      expect(prisma.order.findMany).toHaveBeenCalled();
    });

    it("should return 500 on error", async () => {
      (prisma.order.findMany as any).mockRejectedValue(new Error("DB Fail"));
      const response = await request(app).get("/orders");
      expect(response.status).toBe(500);
    });
  });

  describe("GET /orders/:id", () => {
    it("should return a single order", async () => {
      const mockOrder = { id: "1", orderIdOnChain: "101" };
      (prisma.order.findUnique as any).mockResolvedValue(mockOrder);

      const response = await request(app).get("/orders/101");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockOrder);
    });

    it("should return 404 if not found", async () => {
      (prisma.order.findUnique as any).mockResolvedValue(null);
      const response = await request(app).get("/orders/999");
      expect(response.status).toBe(404);
    });
  });

  describe("GET /orders/buyer/:address", () => {
    it("should filter orders by buyer", async () => {
      const mockOrders = [{ id: "1", buyerAddress: "addr1" }];
      (prisma.order.findMany as any).mockResolvedValue(mockOrders);

      const response = await request(app).get("/orders/buyer/addr1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockOrders);
      expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { buyerAddress: "addr1" }
      }));
    });
  });

  describe("GET /orders/seller/:address", () => {
    it("should filter orders by seller", async () => {
      const mockOrders = [{ id: "2", sellerAddress: "addr2" }];
      (prisma.order.findMany as any).mockResolvedValue(mockOrders);

      const response = await request(app).get("/orders/seller/addr2");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockOrders);
      expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { sellerAddress: "addr2" }
      }));
    });
  });
});
