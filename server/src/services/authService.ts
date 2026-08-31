import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "../config/database.js";
import { ApiError } from "../http/errors.js";
import { config } from "../config/index.js";
import { toServerRole, type ServerProfileRole } from "../lib/profileDto.js";

if (!config.jwtSecret) {
  throw new Error("JWT_SECRET is not configured");
}
const JWT_SECRET: string = config.jwtSecret;
const JWT_EXPIRES_IN = "15m";
const NONCE_TTL_MS = 5 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SIGN_IN_DOMAIN = "agrocylo.global";
// Cross-app SSO handoff (Issue #686): short-lived, single-use, signed token
// minted for an already-authenticated wallet so the agro-production app can
// verify it and establish its own session without re-signing a nonce.
export const HANDOFF_AUDIENCE = "agrocylo-sso-handoff";
const HANDOFF_EXPIRES_IN = "60s";

export async function resolveWalletRole(walletAddress: string): Promise<ServerProfileRole> {
  const normalized = walletAddress.toUpperCase();
  // 1. Env allowlist — immediate source of truth for bootstrapping / emergency admin grant
  //    (checked before DB so a fresh deploy can promote without a DB write).
  const allowlist = (config as unknown as { adminWallets?: string[] }).adminWallets;
  if (Array.isArray(allowlist) && allowlist.includes(normalized)) {
    return "ADMIN";
  }
  // 2. DB users.role — managed via grant-admin CLI / admin panel
  try {
    const user = await prisma.user.findUnique({
      where: { walletAddress },
      select: { role: true },
    });
    if (user?.role) {
      const r = user.role.trim().toUpperCase();
      if (r === "ADMIN" || r === "FARMER" || r === "BUYER") return r as ServerProfileRole;
    }
  } catch {
    // ignore DB errors — fall through to profile check
  }
  // 3. Profile role — alternative source if users row not yet created
  try {
    const profile = await prisma.profile.findUnique({
      where: { wallet_address: walletAddress },
      select: { role: true },
    });
    if (profile?.role) {
      return toServerRole(profile.role);
    }
  } catch {
    // ignore
  }
  // 4. Default: BUYER (covers farmer/buyer generic; matches DB enum)
  return "BUYER";
}

function isStellarAddress(address: string): boolean {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function canonicalWalletAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

export async function generateNonce(
  walletAddress: string,
): Promise<{ nonce: string; message: string; expiresAt: string }> {
  if (!isStellarAddress(walletAddress)) {
    throw new ApiError(400, "Bad Request", "Invalid Stellar wallet address");
  }
  const canonical = canonicalWalletAddress(walletAddress);

  const existing = await prisma.nonce.findUnique({ where: { walletAddress: canonical } });
  if (existing && new Date(existing.expiresAt) > new Date()) {
    return {
      nonce: existing.nonce,
      message: buildSignInMessage(walletAddress, existing.nonce, existing.createdAt, existing.expiresAt),
      expiresAt: existing.expiresAt.toISOString(),
    };
  }

  const nonce = crypto.randomBytes(32).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await prisma.nonce.upsert({
    where: { walletAddress: canonical },
    create: { walletAddress: canonical, nonce, expiresAt, createdAt: issuedAt },
    update: { nonce, expiresAt, createdAt: issuedAt },
  });
  return { nonce, message: buildSignInMessage(walletAddress, nonce, issuedAt, expiresAt), expiresAt: expiresAt.toISOString() };
}

export function buildSignInMessage(walletAddress: string, nonce: string, issuedAt: Date, expiresAt: Date): string {
  return [
    "Agrocylo Global wants you to sign in with your Stellar wallet.",
    `Domain: ${SIGN_IN_DOMAIN}`,
    `Wallet Address: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function verifySignature(
  walletAddress: string,
  signature: string,
  message: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  if (!isStellarAddress(walletAddress)) {
    throw new ApiError(400, "Bad Request", "Invalid Stellar wallet address");
  }
  const canonical = canonicalWalletAddress(walletAddress);

  const row = await prisma.nonce.findUnique({ where: { walletAddress: canonical } });
  if (!row)
    throw new ApiError(401, "Unauthorized", "No nonce found for this wallet");
  if (new Date(row.expiresAt) < new Date()) {
    throw new ApiError(401, "Unauthorized", "Nonce has expired, request a new one");
  }
  if (new Date(row.createdAt).getTime() + NONCE_TTL_MS < Date.now()) {
    throw new ApiError(401, "Unauthorized", "Sign-in message has expired");
  }

  const expectedMessage = buildSignInMessage(walletAddress, row.nonce, row.createdAt, row.expiresAt);
  if (message !== expectedMessage) {
    throw new ApiError(401, "Unauthorized", "Sign-in message fields do not match the issued challenge");
  }

  try {
    const keypair = Keypair.fromPublicKey(walletAddress);
    const messageBuffer = Buffer.from(expectedMessage, "utf-8");
    const signatureBuffer = Buffer.from(signature, "base64");
    const valid = keypair.verify(messageBuffer, signatureBuffer);
    if (!valid) throw new Error();
  } catch {
    throw new ApiError(401, "Unauthorized", "Invalid signature");
  }

  // One-time nonce: delete immediately after successful verification
  await prisma.nonce.delete({ where: { walletAddress: canonical } });

  // Canonical identity creation via single code path (shared with indexer)
  await IdentityService.ensureUserAndProfile(canonical);

  const role = await resolveWalletRole(walletAddress);
  const accessToken = jwt.sign({ walletAddress, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await prisma.refreshToken.create({
    data: { walletAddress: canonical, token: hashRefreshToken(refreshToken), expiresAt: refreshExpiresAt },
  });

  return { accessToken, refreshToken };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(refreshToken);
  const row = await prisma.refreshToken.findUnique({ where: { token: tokenHash } });
  if (!row) throw new ApiError(401, "Unauthorized", "Invalid refresh token");
  if (new Date(row.expiresAt) < new Date()) {
    await prisma.refreshToken.delete({ where: { token: tokenHash } });
    throw new ApiError(401, "Unauthorized", "Refresh token expired");
  }

  // Rotate: invalidate the used token and issue a fresh one
  await prisma.refreshToken.delete({ where: { token: tokenHash } });

  const role = await resolveWalletRole(row.walletAddress);
  const accessToken = jwt.sign({ walletAddress: row.walletAddress, role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
  const newRefreshToken = crypto.randomBytes(40).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await prisma.refreshToken.create({
    data: { walletAddress: row.walletAddress, token: hashRefreshToken(newRefreshToken), expiresAt: refreshExpiresAt },
  });

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { token: hashRefreshToken(refreshToken) } });
}

export function generateHandoffToken(walletAddress: string): string {
  return jwt.sign({ walletAddress }, JWT_SECRET, {
    expiresIn: HANDOFF_EXPIRES_IN,
    audience: HANDOFF_AUDIENCE,
    jwtid: crypto.randomUUID(),
  });
}
