import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Keypair } from "@stellar/stellar-sdk";
import { query } from "../config/database.js";
import { ApiError } from "../http/errors.js";
import { config } from "../config/index.js";

const JWT_SECRET = config.jwtSecret;
const JWT_EXPIRES_IN = "15m";
const NONCE_TTL_MS = 5 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isStellarAddress(address: string): boolean {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export async function generateNonce(
  walletAddress: string,
): Promise<{ nonce: string }> {
  if (!isStellarAddress(walletAddress)) {
    throw new ApiError(400, "Bad Request", "Invalid Stellar wallet address");
  }

  const nonce = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await query(
    `insert into public."Nonce" (id, "walletAddress", nonce, "expiresAt")
     values (gen_random_uuid(), $1, $2, $3)
     on conflict ("walletAddress") do update
     set nonce = $2, "expiresAt" = $3, "createdAt" = now()`,
    [walletAddress, nonce, expiresAt],
  );
  return { nonce };
}

export async function verifySignature(
  walletAddress: string,
  signature: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  if (!isStellarAddress(walletAddress)) {
    throw new ApiError(400, "Bad Request", "Invalid Stellar wallet address");
  }

  const result = await query(
    `select nonce, "expiresAt" from public."Nonce" where "walletAddress" = $1`,
    [walletAddress],
  );

  const row = result.rows[0];
  if (!row)
    throw new ApiError(401, "Unauthorized", "No nonce found for this wallet");
  if (new Date(row.expiresAt) < new Date()) {
    throw new ApiError(401, "Unauthorized", "Nonce has expired, request a new one");
  }

  try {
    const keypair = Keypair.fromPublicKey(walletAddress);
    const messageBuffer = Buffer.from(row.nonce, "utf-8");
    const signatureBuffer = Buffer.from(signature, "base64");
    const valid = keypair.verify(messageBuffer, signatureBuffer);
    if (!valid) throw new Error();
  } catch {
    throw new ApiError(401, "Unauthorized", "Invalid signature");
  }

  // One-time nonce: delete immediately after successful verification
  await query(`delete from public."Nonce" where "walletAddress" = $1`, [walletAddress]);

  const accessToken = jwt.sign({ walletAddress, role: 'USER' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await query(
    `insert into public."RefreshToken" (id, "walletAddress", token, "expiresAt") values (gen_random_uuid(), $1, $2, $3)`,
    [walletAddress, refreshToken, refreshExpiresAt],
  );

  return { accessToken, refreshToken };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const result = await query(
    `select "walletAddress", "expiresAt" from public."RefreshToken" where token = $1`,
    [refreshToken],
  );

  const row = result.rows[0];
  if (!row) throw new ApiError(401, "Unauthorized", "Invalid refresh token");
  if (new Date(row.expiresAt) < new Date()) {
    await query(`delete from public."RefreshToken" where token = $1`, [refreshToken]);
    throw new ApiError(401, "Unauthorized", "Refresh token expired");
  }

  // Rotate: invalidate the used token and issue a fresh one
  await query(`delete from public."RefreshToken" where token = $1`, [refreshToken]);

  const accessToken = jwt.sign({ walletAddress: row.walletAddress, role: 'USER' }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
  const newRefreshToken = crypto.randomBytes(40).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await query(
    `insert into public."RefreshToken" (id, "walletAddress", token, "expiresAt") values (gen_random_uuid(), $1, $2, $3)`,
    [row.walletAddress, newRefreshToken, refreshExpiresAt],
  );

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  await query(`delete from public."RefreshToken" where token = $1`, [refreshToken]);
}
