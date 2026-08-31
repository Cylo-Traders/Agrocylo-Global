import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_JWT_SECRET = vi.hoisted(() => 'test-jwt-secret-at-least-32-characters-long!!');
const mockAdminWallets = vi.hoisted(() => [] as string[]);

vi.mock('../config/index.js', () => ({
  config: { jwtSecret: TEST_JWT_SECRET, adminWallets: mockAdminWallets },
}));

vi.mock('../config/database.js', () => ({
  prisma: {
    nonce: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    user: { findUnique: vi.fn(), upsert: vi.fn() },
    profile: { findUnique: vi.fn() },
  },
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromPublicKey: vi.fn(),
  },
}));

import { buildSignInMessage, generateNonce, verifySignature, refreshAccessToken, logout } from './authService.js';
import { prisma } from '../config/database.js';
import { Keypair } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

const mockNonceUpsert = vi.mocked(prisma.nonce.upsert);
const mockNonceFindUnique = vi.mocked(prisma.nonce.findUnique);
const mockNonceDelete = vi.mocked(prisma.nonce.delete);
const mockRefreshTokenCreate = vi.mocked(prisma.refreshToken.create);
const mockRefreshTokenFindUnique = vi.mocked(prisma.refreshToken.findUnique);
const mockRefreshTokenDelete = vi.mocked(prisma.refreshToken.delete);
const mockRefreshTokenDeleteMany = vi.mocked(prisma.refreshToken.deleteMany);
const mockFromPublicKey = vi.mocked(Keypair.fromPublicKey);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockProfileFindUnique = vi.mocked((prisma as any).profile.findUnique);

const VALID_WALLET = 'GBSOMEWALLET123456';
const FUTURE_DATE_OBJ = new Date(Date.now() + 60_000);
const PAST_DATE_OBJ = new Date(Date.now() - 60_000);
const ISSUED_AT = new Date();

function challenge(overrides: Record<string, unknown> = {}) {
  return { nonce: 'some-nonce', createdAt: ISSUED_AT, expiresAt: FUTURE_DATE_OBJ, ...overrides } as any;
}

function message(row = challenge()) {
  return buildSignInMessage(VALID_WALLET, row.nonce, row.createdAt, row.expiresAt);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFromPublicKey.mockReturnValue({ verify: vi.fn().mockReturnValue(true) } as any);
  mockNonceFindUnique.mockResolvedValue(null);
  mockUserFindUnique.mockResolvedValue(null);
  mockProfileFindUnique.mockResolvedValue(null);
  mockAdminWallets.length = 0;
});

describe('generateNonce', () => {
  it('returns a nonce for a valid Stellar address', async () => {
    mockNonceUpsert.mockResolvedValueOnce({} as any);

    const result = await generateNonce(VALID_WALLET);

    expect(result.nonce).toBeDefined();
    expect(result.message).toContain(`Wallet Address: ${VALID_WALLET}`);
    expect(typeof result.nonce).toBe('string');
    expect(result.nonce).toHaveLength(64);
    expect(mockNonceUpsert).toHaveBeenCalledOnce();
  });

  it('throws 400 for an invalid Stellar address', async () => {
    mockFromPublicKey.mockImplementationOnce(() => {
      throw new Error('Invalid key');
    });

    await expect(generateNonce('INVALID_ADDRESS')).rejects.toMatchObject({ status: 400 });
  });

  it('reuses an unexpired challenge instead of overwriting the wallet nonce', async () => {
    const row = challenge();
    mockNonceFindUnique.mockResolvedValueOnce(row);

    const result = await generateNonce(VALID_WALLET);

    expect(result.nonce).toBe(row.nonce);
    expect(mockNonceUpsert).not.toHaveBeenCalled();
  });
});

describe('verifySignature', () => {
  it('returns access and refresh tokens on valid signature', async () => {
    const row = challenge();
    mockNonceFindUnique.mockResolvedValueOnce(row);
    mockNonceDelete.mockResolvedValueOnce({} as any);
    mockRefreshTokenCreate.mockResolvedValueOnce({} as any);

    const result = await verifySignature(VALID_WALLET, 'dGVzdA==', message(row));

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(mockNonceFindUnique).toHaveBeenCalledTimes(1);
    expect(mockNonceDelete).toHaveBeenCalledTimes(1);
    expect(mockRefreshTokenCreate).toHaveBeenCalledTimes(1);
  });

  it('throws 400 for an invalid Stellar address', async () => {
    mockFromPublicKey.mockImplementationOnce(() => {
      throw new Error('Invalid');
    });

    await expect(verifySignature('INVALID', 'sig', 'message')).rejects.toMatchObject({ status: 400 });
  });

  it('throws 401 when no nonce exists for the wallet', async () => {
    mockNonceFindUnique.mockResolvedValueOnce(null);

    await expect(verifySignature(VALID_WALLET, 'sig', 'message')).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 when the nonce has expired', async () => {
    mockNonceFindUnique.mockResolvedValueOnce({
      nonce: 'old-nonce',
      createdAt: PAST_DATE_OBJ,
      expiresAt: PAST_DATE_OBJ,
    } as any);

    await expect(verifySignature(VALID_WALLET, 'sig', 'message')).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 when the signature is invalid', async () => {
    const row = challenge();
    mockNonceFindUnique.mockResolvedValueOnce(row);
    mockFromPublicKey
      .mockReturnValueOnce({ verify: vi.fn().mockReturnValue(true) } as any)
      .mockReturnValueOnce({ verify: vi.fn().mockReturnValue(false) } as any);

    await expect(verifySignature(VALID_WALLET, 'dGVzdA==', message(row))).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a message with a tampered structured field', async () => {
    const row = challenge();
    mockNonceFindUnique.mockResolvedValueOnce(row);
    await expect(
      verifySignature(VALID_WALLET, 'dGVzdA==', message(row).replace('agrocylo.global', 'evil.example')),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a challenge with an expired issued-at time', async () => {
    const row = challenge({ createdAt: new Date(Date.now() - 6 * 60 * 1000) });
    mockNonceFindUnique.mockResolvedValueOnce(row);
    await expect(verifySignature(VALID_WALLET, 'dGVzdA==', message(row))).rejects.toMatchObject({ status: 401 });
  });
});

describe('refreshAccessToken', () => {
  it('returns new tokens for a valid refresh token', async () => {
    mockRefreshTokenFindUnique.mockResolvedValueOnce({
      walletAddress: VALID_WALLET,
      expiresAt: FUTURE_DATE_OBJ,
    } as any);
    mockRefreshTokenDelete.mockResolvedValueOnce({} as any);
    mockRefreshTokenCreate.mockResolvedValueOnce({} as any);

    const result = await refreshAccessToken('valid-refresh-token');

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(mockRefreshTokenFindUnique).toHaveBeenCalledTimes(1);
    expect(mockRefreshTokenFindUnique).toHaveBeenCalledWith({
      where: { token: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(mockRefreshTokenDelete).toHaveBeenCalledTimes(1);
    expect(mockRefreshTokenCreate).toHaveBeenCalledTimes(1);
    expect(mockRefreshTokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ token: expect.not.stringMatching(/^valid-refresh-token$/) }),
    });
  });

  it('throws 401 for an unknown refresh token', async () => {
    mockRefreshTokenFindUnique.mockResolvedValueOnce(null);

    await expect(refreshAccessToken('bad-token')).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 and deletes the token when it has expired', async () => {
    mockRefreshTokenFindUnique.mockResolvedValueOnce({
      walletAddress: VALID_WALLET,
      expiresAt: PAST_DATE_OBJ,
    } as any);
    mockRefreshTokenDelete.mockResolvedValueOnce({} as any);

    await expect(refreshAccessToken('expired-token')).rejects.toMatchObject({ status: 401 });
    expect(mockRefreshTokenDelete).toHaveBeenCalledTimes(1);
  });
});

describe('logout', () => {
  it('deletes the refresh token from the database', async () => {
    mockRefreshTokenDeleteMany.mockResolvedValueOnce({ count: 1 } as any);

    await logout('some-refresh-token');

    expect(mockRefreshTokenDeleteMany).toHaveBeenCalledOnce();
    expect(mockRefreshTokenDeleteMany).toHaveBeenCalledWith({
      where: { token: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
  });
});

describe('role resolution — JWT aligns with DB enum (FARMER|BUYER|ADMIN)', () => {
  const ADMIN_WALLET = 'GADMIN123456789ADMIN123456789ADMIN123456789AB';
  const FARMER_WALLET = 'GFARMER123456FARMER123456789FARMER123456789A';
  const BUYER_WALLET = 'GBUYER123456789BUYER123456789BUYER123456789AB';

  function validChallengeFor(wallet: string) {
    return { nonce: 'some-nonce', createdAt: ISSUED_AT, expiresAt: FUTURE_DATE_OBJ } as any;
  }

  it('admin wallet via ADMIN_WALLETS allowlist receives role ADMIN', async () => {
    mockAdminWallets.push(ADMIN_WALLET);
    const row = validChallengeFor(ADMIN_WALLET);
    mockNonceFindUnique.mockResolvedValueOnce(row);
    mockNonceDelete.mockResolvedValueOnce({} as any);
    mockRefreshTokenCreate.mockResolvedValueOnce({} as any);

    const msg = buildSignInMessage(ADMIN_WALLET, row.nonce, row.createdAt, row.expiresAt);
    const { accessToken } = await verifySignature(ADMIN_WALLET, 'dGVzdA==', msg);
    const decoded = jwt.verify(accessToken, TEST_JWT_SECRET) as any;
    expect(decoded.role).toBe('ADMIN');
    expect(decoded.walletAddress).toBe(ADMIN_WALLET);
  });

  it('admin wallet via users.role ADMIN receives role ADMIN', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ role: 'ADMIN' } as any);
    const row = validChallengeFor(ADMIN_WALLET);
    mockNonceFindUnique.mockResolvedValueOnce(row);
    mockNonceDelete.mockResolvedValueOnce({} as any);
    mockRefreshTokenCreate.mockResolvedValueOnce({} as any);

    const msg = buildSignInMessage(ADMIN_WALLET, row.nonce, row.createdAt, row.expiresAt);
    const { accessToken } = await verifySignature(ADMIN_WALLET, 'dGVzdA==', msg);
    const decoded = jwt.verify(accessToken, TEST_JWT_SECRET) as any;
    expect(decoded.role).toBe('ADMIN');
  });

  it('farmer wallet via profile.role FARMER receives role FARMER', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    mockProfileFindUnique.mockResolvedValueOnce({ role: 'FARMER' } as any);
    const row = validChallengeFor(FARMER_WALLET);
    mockNonceFindUnique.mockResolvedValueOnce(row);
    mockNonceDelete.mockResolvedValueOnce({} as any);
    mockRefreshTokenCreate.mockResolvedValueOnce({} as any);

    const msg = buildSignInMessage(FARMER_WALLET, row.nonce, row.createdAt, row.expiresAt);
    const { accessToken } = await verifySignature(FARMER_WALLET, 'dGVzdA==', msg);
    const decoded = jwt.verify(accessToken, TEST_JWT_SECRET) as any;
    expect(decoded.role).toBe('FARMER');
  });

  it('non-admin wallet defaults to BUYER, not legacy USER', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    mockProfileFindUnique.mockResolvedValueOnce(null);
    const row = validChallengeFor(BUYER_WALLET);
    mockNonceFindUnique.mockResolvedValueOnce(row);
    mockNonceDelete.mockResolvedValueOnce({} as any);
    mockRefreshTokenCreate.mockResolvedValueOnce({} as any);

    const msg = buildSignInMessage(BUYER_WALLET, row.nonce, row.createdAt, row.expiresAt);
    const { accessToken } = await verifySignature(BUYER_WALLET, 'dGVzdA==', msg);
    const decoded = jwt.verify(accessToken, TEST_JWT_SECRET) as any;
    expect(decoded.role).toBe('BUYER');
    expect(decoded.role).not.toBe('USER');
    expect(['FARMER', 'BUYER', 'ADMIN']).toContain(decoded.role);
  });

  it('refreshAccessToken reflects current DB role (admin → admin, non-admin → buyer)', async () => {
    // First: admin via allowlist
    mockAdminWallets.push(ADMIN_WALLET);
    mockRefreshTokenFindUnique.mockResolvedValueOnce({
      walletAddress: ADMIN_WALLET,
      expiresAt: FUTURE_DATE_OBJ,
    } as any);
    mockRefreshTokenDelete.mockResolvedValueOnce({} as any);
    mockRefreshTokenCreate.mockResolvedValueOnce({} as any);
    const adminResult = await refreshAccessToken('admin-refresh');
    const adminDecoded = jwt.verify(adminResult.accessToken, TEST_JWT_SECRET) as any;
    expect(adminDecoded.role).toBe('ADMIN');

    // Second: same wallet after removal from allowlist and DB demoted → BUYER
    mockAdminWallets.length = 0;
    mockUserFindUnique.mockResolvedValueOnce({ role: 'BUYER' } as any);
    mockProfileFindUnique.mockResolvedValueOnce(null);
    mockRefreshTokenFindUnique.mockResolvedValueOnce({
      walletAddress: ADMIN_WALLET,
      expiresAt: FUTURE_DATE_OBJ,
    } as any);
    mockRefreshTokenDelete.mockResolvedValueOnce({} as any);
    mockRefreshTokenCreate.mockResolvedValueOnce({} as any);
    const buyerResult = await refreshAccessToken('same-wallet-now-buyer');
    const buyerDecoded = jwt.verify(buyerResult.accessToken, TEST_JWT_SECRET) as any;
    expect(buyerDecoded.role).toBe('BUYER');
  });

  it('never issues JWT with legacy USER role', async () => {
    const wallets = [ADMIN_WALLET, FARMER_WALLET, BUYER_WALLET];
    for (const w of wallets) {
      mockUserFindUnique.mockResolvedValueOnce(null);
      mockProfileFindUnique.mockResolvedValueOnce(null);
      const row = validChallengeFor(w);
      mockNonceFindUnique.mockResolvedValueOnce(row);
      mockNonceDelete.mockResolvedValueOnce({} as any);
      mockRefreshTokenCreate.mockResolvedValueOnce({} as any);
      const msg = buildSignInMessage(w, row.nonce, row.createdAt, row.expiresAt);
      const { accessToken } = await verifySignature(w, 'dGVzdA==', msg);
      const decoded = jwt.verify(accessToken, TEST_JWT_SECRET) as any;
      expect(decoded.role).not.toBe('USER');
    }
  });
});
