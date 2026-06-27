import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockVerifySession } = vi.hoisted(() => ({
  mockVerifySession: vi.fn(),
}));

vi.mock("../services/walletAuthService.js", () => ({
  verifySession: mockVerifySession,
}));

vi.mock("express-rate-limit", () => ({
  default: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../db/client.js", () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    investment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      upsert: vi.fn(),
    },
    transaction: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
  connectDB: vi.fn(),
}));

vi.mock("../services/wsServer.js", () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
}));

vi.mock("../services/sorobanEventListener.js", () => ({
  startSorobanEventListener: vi.fn().mockResolvedValue(null),
}));

vi.mock("../events/watcher.js", () => ({
  startProductionWatcher: vi.fn().mockResolvedValue(null),
}));

vi.mock("../config/database.js", () => ({
  query: vi.fn(),
}));

vi.mock("../config/supabase.js", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import app from "../app.js";

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const UUID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const FUTURE = "2030-01-01T00:00:00.000Z";

describe("Smoke tests — all documented public endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /health", () => {
    it("returns status UP", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("UP");
    });
  });

  describe("GET /livez", () => {
    it("returns alive status", async () => {
      const res = await request(app).get("/livez");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("alive");
      expect(typeof res.body.uptime).toBe("number");
    });
  });

  describe("GET /readyz", () => {
    it("returns ready when database is healthy", async () => {
      const { prisma } = await import("../db/client.js");
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ 1: 1 }]);

      const res = await request(app).get("/readyz");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
      expect(res.body.checks.database.status).toBe("UP");
    });

    it("returns not_ready when database is down", async () => {
      const { prisma } = await import("../db/client.js");
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));

      const res = await request(app).get("/readyz");
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("not_ready");
      expect(res.body.checks.database.status).toBe("DOWN");
    });
  });

  describe("GET /api/docs/openapi.json", () => {
    it("returns OpenAPI 3.0.3 spec", async () => {
      const res = await request(app).get("/api/docs/openapi.json");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe("3.0.3");
      expect(res.body.info.title).toBe("Agrocylo Production API");
    });
  });

  describe("GET /api/v1/campaigns", () => {
    it("returns 200", async () => {
      const res = await request(app).get("/api/v1/campaigns");
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/v1/campaigns", () => {
    beforeEach(() => {
      mockVerifySession.mockResolvedValue({
        walletAddress: WALLET,
        sessionToken: "smoke-session",
      });
    });

    it("returns 400 for missing body", async () => {
      const res = await request(app)
        .post("/api/v1/campaigns")
        .set("Authorization", "Bearer smoke-session")
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/campaigns/:id", () => {
    it("returns 400 for invalid UUID", async () => {
      const res = await request(app).get("/api/v1/campaigns/not-uuid");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/campaigns/:id/investments", () => {
    it("returns 400 for invalid UUID", async () => {
      const res = await request(app).get("/api/v1/campaigns/not-uuid/investments");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/investments", () => {
    it("returns 400 without query param", async () => {
      const res = await request(app).get("/api/v1/investments");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/campaigns/:id/invest", () => {
    beforeEach(() => {
      mockVerifySession.mockResolvedValue({
        walletAddress: WALLET,
        sessionToken: "smoke-session",
      });
    });

    it("returns 400 for missing body", async () => {
      const res = await request(app)
        .post(`/api/v1/campaigns/${UUID}/invest`)
        .set("Authorization", "Bearer smoke-session")
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/orders", () => {
    it("returns 400 without query param", async () => {
      const res = await request(app).get("/api/v1/orders");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/orders", () => {
    beforeEach(() => {
      mockVerifySession.mockResolvedValue({
        walletAddress: WALLET,
        sessionToken: "smoke-session",
      });
    });

    it("returns 400 for missing body", async () => {
      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", "Bearer smoke-session")
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/orders/:id", () => {
    it("returns 400 for invalid UUID", async () => {
      const res = await request(app).get("/api/v1/orders/not-uuid");
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/v1/orders/:id/confirm", () => {
    beforeEach(() => {
      mockVerifySession.mockResolvedValue({
        walletAddress: WALLET,
        sessionToken: "smoke-session",
      });
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await request(app)
        .patch("/api/v1/orders/not-uuid/confirm")
        .set("Authorization", "Bearer smoke-session");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /campaigns/:campaign_id/image", () => {
    it("returns 401 without wallet header", async () => {
      const res = await request(app).post(`/campaigns/${UUID}/image`);
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /campaigns/:campaign_id/image", () => {
    it("returns 401 without wallet header", async () => {
      const res = await request(app).delete(`/campaigns/${UUID}/image`);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/transactions", () => {
    it("returns 401 without wallet header", async () => {
      const res = await request(app).post("/api/v1/transactions").send({
        requestId: UUID,
        txHash: "abc",
        walletAddress: WALLET,
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/transactions/:requestId", () => {
    it("returns 400 for invalid UUID", async () => {
      const res = await request(app).get("/api/v1/transactions/not-uuid");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/transactions", () => {
    it("returns 401 without wallet header", async () => {
      const res = await request(app).get("/api/v1/transactions");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /metrics/rate-limits", () => {
    it("returns 200 when no metrics API key is configured", async () => {
      const res = await request(app).get("/metrics/rate-limits");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /metrics/events", () => {
    it("returns 200 when no metrics API key is configured", async () => {
      const res = await request(app).get("/metrics/events");
      expect(res.status).toBe(200);
    });
  });
});
