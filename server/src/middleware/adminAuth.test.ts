import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import type { Response } from "express";

const TEST_JWT_SECRET = "test-secret-at-least-32-chars-long!!";
const ADMIN_WALLET = "GADMIN123456789ADMIN123456789ADMIN123456789AB";
const BUYER_WALLET = "GBUYER123456789BUYER123456789BUYER123456789AB";

vi.mock("../config/index.js", () => ({
  config: { jwtSecret: TEST_JWT_SECRET },
}));

const mockFindUnique = vi.fn();

vi.mock("../config/database.js", () => ({
  prisma: {
    user: { findUnique: mockFindUnique },
  },
}));

vi.mock("../config/logger.js", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { requireAdmin } = await import("./adminAuth.js");

function makeRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

function makeReq(token?: string): any {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" && token ? `Bearer ${token}` : undefined),
    ip: "127.0.0.1",
  };
}

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing Authorization header with 401", () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req as any, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects token with role BUYER (non-admin) with 403", () => {
    const token = jwt.sign({ walletAddress: BUYER_WALLET, role: "BUYER" }, TEST_JWT_SECRET, { expiresIn: "15m" });
    const req = makeReq(token);
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects legacy USER role token with 403", () => {
    const token = jwt.sign({ walletAddress: BUYER_WALLET, role: "USER" }, TEST_JWT_SECRET, { expiresIn: "15m" });
    const req = makeReq(token);
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects FARMER role token with 403", () => {
    const token = jwt.sign({ walletAddress: BUYER_WALLET, role: "FARMER" }, TEST_JWT_SECRET, { expiresIn: "15m" });
    const req = makeReq(token);
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects ADMIN JWT when DB says user is not ADMIN (stale token) with 403", async () => {
    const token = jwt.sign({ walletAddress: BUYER_WALLET, role: "ADMIN" }, TEST_JWT_SECRET, { expiresIn: "15m" });
    mockFindUnique.mockResolvedValueOnce({ role: "BUYER" });
    const req = makeReq(token);
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req as any, res, next);
    // Wait for the async DB check
    await new Promise((r) => setTimeout(r, 10));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts ADMIN JWT when DB confirms ADMIN and calls next()", async () => {
    const token = jwt.sign({ walletAddress: ADMIN_WALLET, role: "ADMIN" }, TEST_JWT_SECRET, { expiresIn: "15m" });
    mockFindUnique.mockResolvedValueOnce({ role: "ADMIN" });
    const req = makeReq(token);
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req as any, res, next);
    await new Promise((r) => setTimeout(r, 10));
    expect(next).toHaveBeenCalledOnce();
    expect(req.adminWallet).toBe(ADMIN_WALLET);
  });

  it("rejects ADMIN JWT when user not found in DB with 403", async () => {
    const token = jwt.sign({ walletAddress: ADMIN_WALLET, role: "ADMIN" }, TEST_JWT_SECRET, { expiresIn: "15m" });
    mockFindUnique.mockResolvedValueOnce(null);
    const req = makeReq(token);
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req as any, res, next);
    await new Promise((r) => setTimeout(r, 10));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 500 when DB check throws", async () => {
    const token = jwt.sign({ walletAddress: ADMIN_WALLET, role: "ADMIN" }, TEST_JWT_SECRET, { expiresIn: "15m" });
    mockFindUnique.mockRejectedValueOnce(new Error("DB down"));
    const req = makeReq(token);
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req as any, res, next);
    await new Promise((r) => setTimeout(r, 10));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects invalid token with 401", () => {
    const req = makeReq("not-a-jwt");
    const res = makeRes();
    const next = vi.fn();
    requireAdmin(req as any, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
