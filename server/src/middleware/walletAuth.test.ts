import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import type { Response } from "express";

vi.mock("../config/index.js", () => ({
  config: { jwtSecret: "test-secret-at-least-32-chars-long!!" },
}));

vi.mock("../services/authService.js", () => ({
  HANDOFF_AUDIENCE: "agrocylo-sso-handoff",
  resolveWalletRole: vi.fn(async () => "BUYER"),
}));

const { requireWallet, requireRole, requireAnyRole } = await import("./walletAuth.js");
const { resolveWalletRole } = await import("../services/authService.js");

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";
const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function makeRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
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

describe("requireRole / requireAnyRole (#1133)", () => {
  const run = (mw: ReturnType<typeof requireRole>, role?: string) => {
    const req: any = { walletRole: role, originalUrl: "/x" };
    const res = makeRes();
    const next = vi.fn();
    mw(req, res, next);
    return { res, next };
  };

  it("allows the matching role", () => {
    expect(run(requireRole("FARMER"), "FARMER").next).toHaveBeenCalledOnce();
  });

  it("denies a different role with 403", () => {
    const { res, next } = run(requireRole("FARMER"), "BUYER");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("denies when the role is missing", () => {
    const { res, next } = run(requireRole("BUYER"));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("lets ADMIN through", () => {
    expect(run(requireRole("FARMER"), "ADMIN").next).toHaveBeenCalledOnce();
  });

  it("requireAnyRole accepts any listed role", () => {
    const mw = requireAnyRole("FARMER", "BUYER");
    expect(run(mw, "BUYER").next).toHaveBeenCalledOnce();
    expect(run(mw, "FARMER").next).toHaveBeenCalledOnce();
  });
});

describe("requireAnyRole re-resolves a stale token role from the DB (#1185)", () => {
  const runAsync = async (mw: ReturnType<typeof requireRole>, role?: string) => {
    const req: any = { walletRole: role, walletAddress: WALLET, originalUrl: "/x" };
    const res = makeRes();
    const next = vi.fn();
    mw(req, res, next);
    await vi.waitFor(() => {
      expect(next.mock.calls.length + (res.status as any).mock.calls.length).toBeGreaterThan(0);
    });
    return { res, next, req };
  };

  it("passes when the DB role satisfies the guard even though the JWT snapshot does not", async () => {
    vi.mocked(resolveWalletRole).mockResolvedValueOnce("FARMER");
    const { next, req } = await runAsync(requireRole("FARMER"), "BUYER");
    expect(next).toHaveBeenCalledOnce();
    expect(req.walletRole).toBe("FARMER");
  });

  it("still denies with 403 when the DB role does not satisfy the guard", async () => {
    vi.mocked(resolveWalletRole).mockResolvedValueOnce("BUYER");
    const { res, next } = await runAsync(requireRole("FARMER"), "BUYER");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
