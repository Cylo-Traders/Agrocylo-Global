import {
  randomUUID,
  timingSafeEqual,
  randomBytes,
  createHash,
} from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Keypair } from '@stellar/stellar-sdk';
import { config } from '../config/index.js';
import { prisma } from '../db/client.js';

const NONCE_EXPIRY_SECS = 300;
const SESSION_EXPIRY_SECS = 900;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Cross-app SSO handoff (Issue #686): audience claim the root server signs
// its handoff tokens with, and the `AuthNonce.audience` used to record a
// consumed handoff token's jti so it can never be replayed.
export const HANDOFF_AUDIENCE = 'agrocylo-sso-handoff';
const HANDOFF_NONCE_AUDIENCE = 'sso-handoff';

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface ChallengeResult {
  nonce: string;
  expiresAt: string;
}

export interface SessionResult {
  accessToken: string;
  sessionToken: string;
  refreshToken: string;
  walletAddress: string;
  expiresAt: string;
}

export interface VerifiedSession {
  walletAddress: string;
  sessionToken: string;
}

export interface VerifiedSessionPrincipal {
  walletAddress: string;
  sessionToken?: string;
  role?: string;
}

export async function createChallenge(
  walletAddress: string,
): Promise<ChallengeResult> {
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + NONCE_EXPIRY_SECS * 1000);

  await prisma.authNonce.create({
    data: {
      walletAddress,
      nonce,
      audience: 'agro-production',
      expiresAt,
    },
  });

  return {
    nonce,
    expiresAt: expiresAt.toISOString(),
  };
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function verifySignatureAndCreateSession(
  walletAddress: string,
  nonce: string,
  signature: string,
): Promise<SessionResult> {
  const nonceRecord = await prisma.authNonce.findUnique({
    where: { nonce },
  });

  if (!nonceRecord) {
    throw new AuthError(401, 'Invalid nonce.');
  }

  if (nonceRecord.usedAt) {
    throw new AuthError(401, 'Nonce already used — replay detected.');
  }

  if (nonceRecord.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new AuthError(401, 'Nonce was issued for a different wallet.');
  }

  if (new Date() > nonceRecord.expiresAt) {
    throw new AuthError(401, 'Nonce has expired.');
  }

  let verified = false;
  try {
    const keypair = Keypair.fromPublicKey(walletAddress);
    const sigBuffer = Buffer.from(signature, 'base64');
    const msgBuffer = Buffer.from(nonce, 'utf-8');
    verified = keypair.verify(msgBuffer, sigBuffer);
  } catch {
    throw new AuthError(401, 'Failed to verify signature.');
  }

  if (!verified) {
    throw new AuthError(401, 'Signature does not match wallet address.');
  }

  await prisma.authNonce.update({
    where: { id: nonceRecord.id },
    data: { usedAt: new Date() },
  });

  const canonical = canonicalWalletAddress(walletAddress);
  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_SECS * 1000);

  // Store session in auth_nonces table for simplicity (reuse infrastructure)
  await prisma.authNonce.create({
    data: {
      walletAddress: canonical,
      nonce: sessionToken,
      audience: 'session',
      expiresAt,
    },
  });

  // Issue JWT access token for consistency with root server
  const accessToken = jwt.sign(
    { walletAddress: canonical, role: 'USER' },
    config.jwtSecret,
    { expiresIn: '15m' },
  );

  // Generate refresh token for session renewal
  const refreshToken = randomBytes(40).toString('hex');
  const refreshHash = hashRefreshToken(refreshToken);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await prisma.authNonce.create({
    data: {
      walletAddress: canonical,
      nonce: refreshHash,
      audience: 'refresh',
      expiresAt: refreshExpiresAt,
    },
  });

  return {
    accessToken,
    sessionToken,
    refreshToken,
    walletAddress: canonical,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function verifyHandoffAndCreateSession(
  handoffToken: string,
): Promise<SessionResult> {
  let walletAddress: string;
  let jti: string;
  try {
    const decoded = jwt.verify(handoffToken, config.jwtSecret, {
      audience: HANDOFF_AUDIENCE,
    }) as jwt.JwtPayload;
    if (
      typeof decoded.walletAddress !== 'string' ||
      typeof decoded.jti !== 'string'
    ) {
      throw new Error('Malformed handoff token payload.');
    }
    walletAddress = decoded.walletAddress;
    jti = decoded.jti;
  } catch {
    throw new AuthError(401, 'Invalid or expired handoff token.');
  }

  const canonical = canonicalWalletAddress(walletAddress);

  // Single-use: `nonce` is unique, so a replayed jti fails this insert with
  // Prisma error P2002. Any other failure (e.g. a transient DB error) is not
  // a replay and should surface as a server error instead of masquerading
  // as one.
  try {
    await prisma.authNonce.create({
      data: {
        walletAddress: canonical,
        nonce: jti,
        audience: HANDOFF_NONCE_AUDIENCE,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    });
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'P2002') {
      throw new AuthError(401, 'Handoff token already used — replay detected.');
    }
    throw err;
  }

  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_SECS * 1000);

  await prisma.authNonce.create({
    data: {
      walletAddress: canonical,
      nonce: sessionToken,
      audience: 'session',
      expiresAt,
    },
  });

  const accessToken = jwt.sign(
    { walletAddress: canonical, role: 'USER' },
    config.jwtSecret,
    { expiresIn: '15m' },
  );

  // Generate refresh token for session renewal
  const refreshToken = randomBytes(40).toString('hex');
  const refreshHash = hashRefreshToken(refreshToken);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await prisma.authNonce.create({
    data: {
      walletAddress: canonical,
      nonce: refreshHash,
      audience: 'refresh',
      expiresAt: refreshExpiresAt,
    },
  });

  return {
    accessToken,
    sessionToken,
    refreshToken,
    walletAddress: canonical,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function verifySession(
  sessionToken: string,
): Promise<VerifiedSession> {
  const record = await prisma.authNonce.findUnique({
    where: { nonce: sessionToken },
  });

  if (!record) {
    throw new AuthError(401, 'Invalid session token.');
  }

  if (record.audience !== 'session') {
    throw new AuthError(401, 'Token is not a session token.');
  }

  if (record.usedAt) {
    throw new AuthError(401, 'Session token has been revoked.');
  }

  if (new Date() > record.expiresAt) {
    throw new AuthError(401, 'Session token has expired.');
  }

  return {
    walletAddress: record.walletAddress,
    sessionToken,
  };
}

export async function revokeSession(sessionToken: string): Promise<void> {
  await prisma.authNonce.updateMany({
    where: { nonce: sessionToken, audience: 'session' },
    data: { usedAt: new Date() },
  });
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function canonicalWalletAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(refreshToken);
  const row = await prisma.authNonce.findUnique({
    where: { nonce: tokenHash },
  });

  if (!row || row.audience !== 'refresh') {
    throw new AuthError(401, 'Invalid refresh token.');
  }

  if (new Date() > row.expiresAt) {
    await prisma.authNonce.delete({
      where: { id: row.id },
    });
    throw new AuthError(401, 'Refresh token expired.');
  }

  // Rotate: invalidate the used token and issue a fresh one
  await prisma.authNonce.delete({
    where: { id: row.id },
  });

  const walletAddress = canonicalWalletAddress(row.walletAddress);
  const accessToken = jwt.sign(
    { walletAddress, role: 'USER' },
    config.jwtSecret,
    { expiresIn: '15m' },
  );

  const newRefreshToken = randomBytes(40).toString('hex');
  const newRefreshHash = hashRefreshToken(newRefreshToken);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await prisma.authNonce.create({
    data: {
      walletAddress,
      nonce: newRefreshHash,
      audience: 'refresh',
      expiresAt: refreshExpiresAt,
    },
  });

  return { accessToken, refreshToken: newRefreshToken };
}

const ALLOWED_SESSION_AUDIENCES = new Set([
  'agro-production',
  'session',
  'agrocylo',
]);

const VALID_ROLES = new Set([
  'INVESTOR',
  'FARMER',
  'BUYER',
  'DISTRIBUTOR',
  'ADMIN',
  'USER',
]);

/**
 * Synchronously verifies a JWT session token.
 * Validates walletAddress, ensures no handoff audience, checks valid audience if present,
 * and validates role and type claims.
 */
export function verifySessionTokenSync(
  token: string,
): VerifiedSessionPrincipal {
  if (!token || typeof token !== 'string') {
    throw new AuthError(401, 'Invalid or expired token');
  }

  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthError(401, 'Session token has expired.');
    }
    throw err;
  }

  if (!decoded || typeof decoded !== 'object') {
    throw new AuthError(401, 'Invalid token: malformed payload');
  }

  const payload = decoded as {
    walletAddress?: unknown;
    role?: unknown;
    type?: unknown;
    aud?: unknown;
  };

  // A cross-app SSO handoff token (Issue #686, #1252) is single-purpose: it may
  // only be redeemed via POST /auth/handoff, never used directly as a session credential.
  const audList = Array.isArray(payload.aud)
    ? payload.aud
    : payload.aud !== undefined
      ? [payload.aud]
      : [];

  if (
    audList.includes(HANDOFF_AUDIENCE) ||
    audList.includes(HANDOFF_NONCE_AUDIENCE)
  ) {
    throw new AuthError(401, 'Invalid token: not a session token');
  }

  if (audList.length > 0) {
    const hasInvalidAudience = audList.some(
      (a) => typeof a !== 'string' || !ALLOWED_SESSION_AUDIENCES.has(a),
    );
    if (hasInvalidAudience) {
      throw new AuthError(401, 'Invalid token: wrong audience');
    }
  }

  if (
    !payload.walletAddress ||
    typeof payload.walletAddress !== 'string' ||
    payload.walletAddress.trim() === ''
  ) {
    throw new AuthError(401, 'Invalid token: missing walletAddress');
  }

  if (payload.type !== undefined) {
    if (
      typeof payload.type !== 'string' ||
      !['session', 'access', 'auth'].includes(payload.type.toLowerCase())
    ) {
      throw new AuthError(401, 'Invalid token: invalid type');
    }
  }

  if (payload.role !== undefined) {
    if (
      typeof payload.role !== 'string' ||
      !VALID_ROLES.has(payload.role.toUpperCase())
    ) {
      throw new AuthError(401, 'Invalid token: invalid role');
    }
  }

  return {
    walletAddress: payload.walletAddress,
    role: typeof payload.role === 'string' ? payload.role : undefined,
  };
}

/**
 * Shared session token verifier for HTTP and WebSocket authentication (Issue #1252).
 * Verifies JWT session tokens first, then falls back to opaque DB session tokens.
 * Rejects SSO handoff tokens, tokens with wrong audience, missing wallet, or invalid role/type.
 */
export async function verifySessionToken(
  token: string,
): Promise<VerifiedSessionPrincipal> {
  try {
    return verifySessionTokenSync(token);
  } catch (err) {
    if (
      err instanceof AuthError &&
      (err.message.startsWith('Invalid token:') ||
        err.message === 'Session token has expired.')
    ) {
      throw err;
    }
    // Not a valid JWT, try database session token lookup
    const session = await verifySession(token);
    return {
      walletAddress: session.walletAddress,
      sessionToken: session.sessionToken,
    };
  }
}
