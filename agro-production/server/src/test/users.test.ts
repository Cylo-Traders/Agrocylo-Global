import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/client.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    dispute: {
      count: vi.fn(),
    },
  },
  connectDB: vi.fn(),
}));

vi.mock("../services/wsServer.js", () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
}));

import app from "../app.js";
import { prisma } from "../db/client.js";

describe("User Profile & Cross-Referencing API (Issue #646)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for unknown wallet address", async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);

    const res = await request(app).get("/api/v1/users/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(res.status).toBe(404);
  });

  it("GET /api/v1/users/:walletAddress returns user profile and cross-referenced activity stats", async () => {
    const validWallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const mockUser = {
      walletAddress: validWallet,
      role: "FARMER",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      _count: {
        campaigns: 2,
        investments: 0,
        orders: 5,
      },
    };

    (prisma.user.findUnique as any).mockResolvedValue(mockUser);
    (prisma.dispute.count as any).mockResolvedValue(1);

    const res = await request(app).get(`/api/v1/users/${validWallet}`);

    expect(res.status).toBe(200);
    expect(res.body.walletAddress).toBe(validWallet);
    expect(res.body.role).toBe("FARMER");
    expect(res.body.stats.campaignsCount).toBe(2);
    expect(res.body.stats.ordersCount).toBe(5);
    expect(res.body.stats.disputesCount).toBe(1);
    expect(res.body.reputationScore).toBe(150); // 100 base + 20 (campaigns) + 50 (orders) - 20 (dispute)
  });
});
