import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import type { Response } from "express";

vi.mock("../config/index.js", () => ({
  config: { jwtSecret: "test-secret-at-least-32-chars-long!!" },
}));

vi.mock("../services/authService.js", () => ({
  HANDOFF_AUDIENCE: "agrocylo-sso-handoff",
}));

const { requireWallet } = await import("./walletAuth.js");

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";
const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function makeRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

describe("requireWallet rejects handoff tokens (Issue #686)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a token carrying the SSO handoff audience claim", () => {
    const handoffToken = jwt.sign({ walletAddress: WALLET }, JWT_SECRET, {
      expiresIn: "60s",
      audience: "agrocylo-sso-handoff",
      jwtid: "some-jti",
    });

    const req: any = { header: () => `Bearer ${handoffToken}` };
    const res = makeRes();
    const next = vi.fn();

    requireWallet(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("accepts a normal session token without a handoff audience claim", () => {
    const sessionToken = jwt.sign({ walletAddress: WALLET, role: "BUYER" }, JWT_SECRET, {
      expiresIn: "15m",
    });

    const req: any = { header: () => `Bearer ${sessionToken}` };
    const res = makeRes();
    const next = vi.fn();

    requireWallet(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.walletAddress).toBe(WALLET);
  });
});

describe("requireWallet role handling (DB enum FARMER|BUYER|ADMIN)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["BUYER", "FARMER", "ADMIN"] as const)("accepts token with role %s and exposes walletRole", (role) => {
    const token = jwt.sign({ walletAddress: WALLET, role }, JWT_SECRET, { expiresIn: "15m" });
    const req: any = { header: () => `Bearer ${token}` };
    const res = makeRes();
    const next = vi.fn();
    requireWallet(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.walletAddress).toBe(WALLET);
    expect(req.walletRole).toBe(role);
  });

  it("accepts tokens without explicit role (backwards compat) but sets walletAddress", () => {
    const token = jwt.sign({ walletAddress: WALLET }, JWT_SECRET, { expiresIn: "15m" });
    const req: any = { header: () => `Bearer ${token}` };
    const res = makeRes();
    const next = vi.fn();
    requireWallet(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.walletAddress).toBe(WALLET);
  });

  it("rejects legacy USER role tokens if walletService expects DB enum — still authenticates but role is not ADMIN", () => {
    // Legacy USER tokens are still valid for wallet auth (they have a walletAddress),
    // but they must not be treated as ADMIN. This test documents that USER is not a DB enum value.
    const legacyToken = jwt.sign({ walletAddress: WALLET, role: "USER" }, JWT_SECRET, { expiresIn: "15m" });
    const req: any = { header: () => `Bearer ${legacyToken}` };
    const res = makeRes();
    const next = vi.fn();
    requireWallet(req, res, next);
    // walletAuth itself does not reject USER — it just exposes the role.
    // Admin check happens in requireAdmin.
    expect(next).toHaveBeenCalledOnce();
    expect(req.walletRole).toBe("USER");
    expect(["ADMIN", "FARMER", "BUYER"]).not.toContain(req.walletRole);
  });
});
