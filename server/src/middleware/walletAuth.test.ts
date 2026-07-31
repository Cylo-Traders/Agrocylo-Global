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
    const sessionToken = jwt.sign({ walletAddress: WALLET, role: "USER" }, JWT_SECRET, {
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
