import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/database.js";
import logger from "../config/logger.js";

export interface IntegratorRequest extends Request {
  integratorApiKeyId?: string;
  integratorScope?: {
    organizationName: string;
    scopedFarmerWallets: string[];
    scopedRegion: string | null;
  };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Authenticates integrator requests via `x-api-key`. Scoped to a named
 * organization and a defined set of farmer wallets or a region (Issue #662),
 * distinct from the wallet-JWT auth used by platform users. Revoked or
 * unknown keys are rejected; usage (including failures) is recorded by the
 * caller via recordUsage() once the response is known.
 */
export async function requireIntegratorApiKey(
  req: IntegratorRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawKey = req.header("x-api-key");
  if (!rawKey) {
    res.status(401).json({ message: "Missing x-api-key header." });
    return;
  }

  try {
    const keyHash = hashApiKey(rawKey);
    const record = await prisma.integratorApiKey.findUnique({ where: { keyHash } });
    if (!record || record.revokedAt) {
      res.status(401).json({ message: "Invalid or revoked API key." });
      return;
    }

    req.integratorApiKeyId = record.id;
    req.integratorScope = {
      organizationName: record.organizationName,
      scopedFarmerWallets: record.scopedFarmerWallets,
      scopedRegion: record.scopedRegion,
    };

    // Best-effort last-used tracking; never blocks the request.
    prisma.integratorApiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch((err) => logger.error("[integratorAuth] Failed to update lastUsedAt", { err }));

    next();
  } catch (err) {
    logger.error("[integratorAuth] Failed to authenticate integrator API key", { err });
    res.status(500).json({ message: "Internal Server Error: could not verify API key." });
  }
}

/** Records an integrator API call for the audit log (Issue #662). */
export function recordIntegratorUsage(
  req: IntegratorRequest,
  res: Response,
  endpoint: string,
): void {
  if (!req.integratorApiKeyId) return;
  prisma.integratorApiKeyUsage
    .create({
      data: {
        apiKeyId: req.integratorApiKeyId,
        endpoint,
        statusCode: res.statusCode,
        ipAddress: req.ip ?? null,
      },
    })
    .catch((err) => logger.error("[integratorAuth] Failed to record usage audit log", { err }));
}
