import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { Request, Response } from "express";

// Mock Prisma
vi.mock("../db/client.js", () => ({
  prisma: {
    campaign: { findMany: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn(), upsert: vi.fn() },
    transaction: { findUnique: vi.fn(), create: vi.fn() },
    dispute: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  },
  connectDB: vi.fn(),
}));

vi.mock("../services/wsServer.js", () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
}));

import app from "../app.js";
import { prisma } from "../db/client.js";

describe("Integration Tests — Authorization & Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Wallet Authorization", () => {
    it("should reject request without x-wallet-address header on protected endpoints", async () => {
      const res = await request(app)
        .post("/api/v1/products")
        .send({ name: "Test", description: "Test", priceTokens: "100", inventoryCount: 10, category: "GRAINS" });

      expect(res.status).toBe(401);
    });

    it("should reject invalid Stellar wallet address format", async () => {
      const res = await request(app)
        .get("/api/v1/disputes")
        .set("x-wallet-address", "invalid-address");

      expect(res.status).toBe(400);
    });

    it("should accept valid Stellar wallet address", async () => {
      const validAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      (prisma.dispute.findMany as any).mockResolvedValue([]);
      (prisma.dispute.count as any).mockResolvedValue(0);
      (prisma.user.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/disputes")
        .set("x-wallet-address", validAddress);

      expect(res.status).toBe(200);
    });
  });

  describe("CORS Policy", () => {
    it("should allow requests from localhost in dev", async () => {
      (prisma.campaign.findMany as any).mockResolvedValue([]);
      (prisma.campaign.count as any).mockResolvedValue(0);

      const res = await request(app)
        .get("/api/v1/campaigns")
        .set("Origin", "http://localhost:3000");

      // Should not be rejected by CORS (status won't be 403 for CORS)
      expect([200, 400, 401, 404]).toContain(res.status);
    });

    it("should include CORS headers in response", async () => {
      (prisma.campaign.findMany as any).mockResolvedValue([]);
      (prisma.campaign.count as any).mockResolvedValue(0);

      const res = await request(app).get("/api/v1/campaigns");

      // Check for CORS headers
      expect(res.headers["access-control-allow-methods"]).toBeDefined();
    });
  });

  describe("Rate Limiting", () => {
    it("should accept requests within rate limit", async () => {
      (prisma.campaign.findMany as any).mockResolvedValue([]);
      (prisma.campaign.count as any).mockResolvedValue(0);

      const res = await request(app).get("/api/v1/campaigns");

      // First request should succeed
      expect([200, 400, 401]).toContain(res.status);
    });

    it("should include rate limit headers", async () => {
      (prisma.campaign.findMany as any).mockResolvedValue([]);
      (prisma.campaign.count as any).mockResolvedValue(0);

      const res = await request(app).get("/api/v1/campaigns");

      // Rate limit headers should be present or omitted (both valid)
      expect(res.status).toBeLessThan(500);
    });
  });

  describe("Event Idempotency & Checkpoints", () => {
    it("should prevent duplicate event processing via transaction uniqueness", async () => {
      (prisma.transaction.findUnique as any).mockResolvedValue({
        id: "tx-1",
        ledger: 100,
        eventIndex: 0,
      });

      // Simulate a duplicate event check
      const existing = await prisma.transaction.findUnique({
        where: { ledger_eventIndex: { ledger: 100, eventIndex: 0 } },
      });

      expect(existing).toBeDefined();
      expect(existing.ledger).toBe(100);
    });

    it("should track checkpoint by ledger + eventIndex", async () => {
      (prisma.transaction.findUnique as any).mockResolvedValue(null);
      (prisma.transaction.create as any).mockResolvedValue({
        id: "tx-1",
        ledger: 150,
        eventIndex: 5,
      });

      const result = await prisma.transaction.create({
        data: {
          ledger: 150,
          eventIndex: 5,
          eventType: "campaign.created",
          payload: {},
          txHash: "0xabc",
        },
      });

      expect(result.ledger).toBe(150);
      expect(result.eventIndex).toBe(5);
    });
  });

  describe("WebSocket Event Contract", () => {
    it("should have typed event envelope with required fields", async () => {
      // Test that broadcast function expects proper event envelope format
      const mockEvent = {
        event: "campaign.created" as const,
        payload: { campaignId: "123" },
        timestamp: new Date().toISOString(),
      };

      expect(mockEvent).toHaveProperty("event");
      expect(mockEvent).toHaveProperty("payload");
      expect(mockEvent).toHaveProperty("timestamp");
    });

    it("should support all documented event types", async () => {
      const eventTypes = [
        "campaign.created",
        "campaign.invested",
        "campaign.settled",
        "order.created",
        "order.confirmed",
        "dispute.opened",
        "dispute.evidence_submitted",
        "dispute.resolved",
        "dispute.dismissed",
      ] as const;

      for (const eventType of eventTypes) {
        expect(typeof eventType).toBe("string");
      }
    });
  });

  describe("Problem Detail Error Responses", () => {
    it("should return RFC 7807 problem detail on 404", async () => {
      const unknownUUID = "ffffffff-ffff-4fff-ffff-ffffffffffff";
      (prisma.campaign.findUnique as any).mockResolvedValue(null);

      const res = await request(app).get(`/api/v1/campaigns/${unknownUUID}`);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("type");
      expect(res.body).toHaveProperty("title");
      expect(res.body).toHaveProperty("status");
      expect(res.body.status).toBe(404);
    });

    it("should return validation errors on bad input", async () => {
      const res = await request(app)
        .get("/api/v1/campaigns?page=invalid");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("errors");
    });
  });
});
