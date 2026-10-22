import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';

vi.mock('../config/index.js', () => ({
  config: { jwtSecret: 'test-secret-at-least-32-chars-long!!' },
}));

vi.mock('../services/walletAuthService.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../services/walletAuthService.js')>();
  return {
    ...actual,
    verifySession: vi.fn(),
  };
});

const { requireWallet } = await import('./walletAuth.js');

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function makeRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('requireWallet rejects handoff tokens (Issue #686)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a token carrying the SSO handoff audience claim', async () => {
    const handoffToken = jwt.sign({ walletAddress: WALLET }, JWT_SECRET, {
      expiresIn: '60s',
      audience: 'agrocylo-sso-handoff',
      jwtid: 'some-jti',
    });

    const req: any = { header: () => `Bearer ${handoffToken}` };
    const res = makeRes();
    const next = vi.fn();

    requireWallet(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts a normal session token without a handoff audience claim', async () => {
    const sessionToken = jwt.sign(
      { walletAddress: WALLET, role: 'USER' },
      JWT_SECRET,
      {
        expiresIn: '15m',
      },
    );

    const req: any = { header: () => `Bearer ${sessionToken}` };
    const res = makeRes();
    const next = vi.fn();

    requireWallet(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.walletAddress).toBe(WALLET);
  });

  it('rejects a token with a wrong audience claim', async () => {
    const wrongAudToken = jwt.sign({ walletAddress: WALLET }, JWT_SECRET, {
      expiresIn: '15m',
      audience: 'untrusted-external-audience',
    });

    const req: any = { header: () => `Bearer ${wrongAudToken}` };
    const res = makeRes();
    const next = vi.fn();

    requireWallet(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid token: wrong audience',
    });
  });

  it('rejects a token with missing walletAddress', async () => {
    const missingWalletToken = jwt.sign({ role: 'USER' }, JWT_SECRET, {
      expiresIn: '15m',
    });

    const req: any = { header: () => `Bearer ${missingWalletToken}` };
    const res = makeRes();
    const next = vi.fn();

    requireWallet(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid token: missing walletAddress',
    });
  });

  it('rejects a token with invalid role', async () => {
    const invalidRoleToken = jwt.sign(
      { walletAddress: WALLET, role: 'INVALID_ROLE' },
      JWT_SECRET,
      {
        expiresIn: '15m',
      },
    );

    const req: any = { header: () => `Bearer ${invalidRoleToken}` };
    const res = makeRes();
    const next = vi.fn();

    requireWallet(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid token: invalid role',
    });
  });

  it('rejects a token with invalid type', async () => {
    const invalidTypeToken = jwt.sign(
      { walletAddress: WALLET, type: 'refresh' },
      JWT_SECRET,
      {
        expiresIn: '15m',
      },
    );

    const req: any = { header: () => `Bearer ${invalidTypeToken}` };
    const res = makeRes();
    const next = vi.fn();

    requireWallet(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid token: invalid type',
    });
  });

  it('accepts a session token with an allowed audience', async () => {
    const allowedToken = jwt.sign(
      { walletAddress: WALLET, role: 'FARMER' },
      JWT_SECRET,
      {
        expiresIn: '15m',
        audience: 'agro-production',
      },
    );

    const req: any = { header: () => `Bearer ${allowedToken}` };
    const res = makeRes();
    const next = vi.fn();

    requireWallet(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.walletAddress).toBe(WALLET);
  });
});
