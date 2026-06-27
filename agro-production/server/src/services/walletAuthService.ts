import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { prisma } from '../db/client.js';

const NONCE_EXPIRY_SECS = 300;
const SESSION_EXPIRY_SECS = 900;

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
  sessionToken: string;
  walletAddress: string;
  expiresAt: string;
}

export interface VerifiedSession {
  walletAddress: string;
  sessionToken: string;
}

export async function createChallenge(walletAddress: string): Promise<ChallengeResult> {
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

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
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

  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_SECS * 1000);

  // Store session in auth_nonces table for simplicity (reuse infrastructure)
  await prisma.authNonce.create({
    data: {
      walletAddress,
      nonce: sessionToken,
      audience: 'session',
      expiresAt,
    },
  });

  return {
    sessionToken,
    walletAddress,
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
