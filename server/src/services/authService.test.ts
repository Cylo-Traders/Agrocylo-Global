import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_JWT_SECRET = vi.hoisted(() => 'test-jwt-secret-at-least-32-characters-long!!');

vi.mock('../config/index.js', () => ({
  config: { jwtSecret: TEST_JWT_SECRET },
}));

vi.mock('../config/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromPublicKey: vi.fn(),
  },
}));

import { generateNonce, verifySignature, refreshAccessToken, logout } from './authService.js';
import * as db from '../config/database.js';
import { Keypair } from '@stellar/stellar-sdk';

const mockQuery = vi.mocked(db.query);
const mockFromPublicKey = vi.mocked(Keypair.fromPublicKey);

const VALID_WALLET = 'GBSOMEWALLET123456';
const FUTURE_DATE = new Date(Date.now() + 60_000).toISOString();
const PAST_DATE = new Date(Date.now() - 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mockFromPublicKey.mockReturnValue({ verify: vi.fn().mockReturnValue(true) } as any);
});

describe('generateNonce', () => {
  it('returns a nonce for a valid Stellar address', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const result = await generateNonce(VALID_WALLET);

    expect(result.nonce).toBeDefined();
    expect(typeof result.nonce).toBe('string');
    expect(result.nonce).toHaveLength(64);
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it('throws 400 for an invalid Stellar address', async () => {
    mockFromPublicKey.mockImplementationOnce(() => {
      throw new Error('Invalid key');
    });

    await expect(generateNonce('INVALID_ADDRESS')).rejects.toMatchObject({ status: 400 });
  });
});

describe('verifySignature', () => {
  it('returns access and refresh tokens on valid signature', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ nonce: 'some-nonce', expiresAt: FUTURE_DATE }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await verifySignature(VALID_WALLET, 'dGVzdA==');

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('throws 400 for an invalid Stellar address', async () => {
    mockFromPublicKey.mockImplementationOnce(() => {
      throw new Error('Invalid');
    });

    await expect(verifySignature('INVALID', 'sig')).rejects.toMatchObject({ status: 400 });
  });

  it('throws 401 when no nonce exists for the wallet', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(verifySignature(VALID_WALLET, 'sig')).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 when the nonce has expired', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ nonce: 'old-nonce', expiresAt: PAST_DATE }],
    } as any);

    await expect(verifySignature(VALID_WALLET, 'sig')).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 when the signature is invalid', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ nonce: 'some-nonce', expiresAt: FUTURE_DATE }],
    } as any);
    // verifySignature calls fromPublicKey twice: once in isStellarAddress (validation),
    // once for the actual keypair used to verify the signature.
    mockFromPublicKey
      .mockReturnValueOnce({ verify: vi.fn().mockReturnValue(true) } as any)
      .mockReturnValueOnce({ verify: vi.fn().mockReturnValue(false) } as any);

    await expect(verifySignature(VALID_WALLET, 'dGVzdA==')).rejects.toMatchObject({ status: 401 });
  });
});

describe('refreshAccessToken', () => {
  it('returns new tokens for a valid refresh token', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ walletAddress: VALID_WALLET, expiresAt: FUTURE_DATE }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await refreshAccessToken('valid-refresh-token');

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('throws 401 for an unknown refresh token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(refreshAccessToken('bad-token')).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 and deletes the token when it has expired', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ walletAddress: VALID_WALLET, expiresAt: PAST_DATE }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    await expect(refreshAccessToken('expired-token')).rejects.toMatchObject({ status: 401 });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('logout', () => {
  it('deletes the refresh token from the database', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await logout('some-refresh-token');

    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('delete'), [
      'some-refresh-token',
    ]);
  });
});
