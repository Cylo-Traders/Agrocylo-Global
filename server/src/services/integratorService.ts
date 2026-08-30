import crypto from "node:crypto";
import { prisma } from "../config/database.js";
import { ApiError, NotFoundError, ValidationError } from "../http/errors.js";
import { hashApiKey } from "../middleware/integratorAuth.js";

export interface IntegratorScope {
  organizationName: string;
  scopedFarmerWallets: string[];
  scopedRegion: string | null;
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_KEY_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

function generateRawKey(): string {
  // 32 bytes of entropy, hex-encoded; only ever returned once at creation.
  return `agc_${crypto.randomBytes(32).toString("hex")}`;
}

export class IntegratorService {
  /** Admin issues a new integrator API key scoped to an org + farmer wallets or region. */
  static async issueKey(params: {
    organizationName: string;
    scopedFarmerWallets?: string[];
    scopedRegion?: string;
    createdByAdmin: string;
  }) {
    const { organizationName, scopedFarmerWallets, scopedRegion, createdByAdmin } = params;
    if (!organizationName) {
      throw new ValidationError("organizationName is required");
    }
    if ((!scopedFarmerWallets || scopedFarmerWallets.length === 0) && !scopedRegion) {
      throw new ValidationError("Either scopedFarmerWallets or scopedRegion must be provided");
    }

    const rawKey = generateRawKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);

    const record = await prisma.integratorApiKey.create({
      data: {
        keyHash,
        keyPrefix,
        organizationName,
        scopedFarmerWallets: scopedFarmerWallets ?? [],
        scopedRegion: scopedRegion ?? null,
        createdByAdmin,
        expiresAt: new Date(Date.now() + DEFAULT_KEY_LIFETIME_MS),
      },
    });

    // The raw key is returned exactly once; it cannot be recovered later.
    return { ...record, rawKey };
  }

  static async listKeys(organizationName?: string) {
    return prisma.integratorApiKey.findMany({
      where: organizationName ? { organizationName } : {},
      select: {
        id: true,
        keyPrefix: true,
        organizationName: true,
        scopedFarmerWallets: true,
        scopedRegion: true,
        createdByAdmin: true,
        revokedAt: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Revocation endpoint for admins to kill a compromised/expired key (Issue #662). */
  static async revokeKey(keyId: string) {
    const record = await prisma.integratorApiKey.findUnique({ where: { id: keyId } });
    if (!record) {
      throw new NotFoundError("Integrator API key", keyId);
    }
    if (record.revokedAt) {
      return record;
    }
    return prisma.integratorApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  static async getUsageLog(keyId: string, limit = 100) {
    return prisma.integratorApiKeyUsage.findMany({
      where: { apiKeyId: keyId },
      orderBy: { requestedAt: "desc" },
      take: Math.min(limit, MAX_PAGE_SIZE),
    });
  }

  /**
   * Aggregate, org-scoped farmer report. Returns only what the scoping
   * organization is entitled to: farmer identity + region, and coarse
   * production activity counts — no wallet-level financial detail such as
   * individual order amounts or campaign investment balances (Issue #662).
   */
  static async getFarmerReport(scope: IntegratorScope) {
    const wallets = await resolveScopedWallets(scope);
    if (wallets.length === 0) return [];

    const [profiles, campaigns] = await Promise.all([
      prisma.profile.findMany({
        where: { walletAddress: { in: wallets }, role: "FARMER" },
        include: { location: true },
      }),
      prisma.campaign.findMany({
        where: { creatorAddress: { in: wallets } },
      }),
    ]);

    const campaignsByFarmer = new Map<string, typeof campaigns>();
    for (const c of campaigns) {
      const list = campaignsByFarmer.get(c.creatorAddress) ?? [];
      list.push(c);
      campaignsByFarmer.set(c.creatorAddress, list);
    }

    return profiles.map((p) => {
      const farmerCampaigns = campaignsByFarmer.get((p as any).walletAddress ?? (p as any).wallet_address) ?? [];
      return {
        farmerWallet: (p as any).walletAddress ?? (p as any).wallet_address,
        displayName: p.name ?? null,
        region: p.location ? [p.location.city, p.location.country].filter(Boolean).join(", ") : null,
        totalCampaigns: farmerCampaigns.length,
        settledCampaigns: farmerCampaigns.filter((c) => c.status === "SETTLED").length,
        activeCampaigns: farmerCampaigns.filter((c) => c.status === "ACTIVE").length,
      };
    });
  }

  /**
   * Aggregate, org-scoped order report. Counts and status breakdown only —
   * no buyer identity or per-order monetary amount, consistent with "no
   * PII/wallet-level financial detail beyond what the scoping organization
   * is entitled to" (Issue #662).
   */
  static async getOrderReport(scope: IntegratorScope) {
    const wallets = await resolveScopedWallets(scope);
    if (wallets.length === 0) return [];

    const orders = await prisma.order.findMany({
      where: { sellerAddress: { in: wallets } },
      select: { sellerAddress: true, status: true, createdAt: true },
    });

    const bySeller = new Map<string, { total: number; completed: number; refunded: number; pending: number }>();
    for (const o of orders) {
      const entry = bySeller.get(o.sellerAddress) ?? { total: 0, completed: 0, refunded: 0, pending: 0 };
      entry.total += 1;
      if (o.status === "COMPLETED") entry.completed += 1;
      else if (o.status === "REFUNDED") entry.refunded += 1;
      else entry.pending += 1;
      bySeller.set(o.sellerAddress, entry);
    }

    return Array.from(bySeller.entries()).map(([farmerWallet, stats]) => ({
      farmerWallet,
      ...stats,
    }));
  }
}

/**
 * Resolves the set of farmer wallets a key's scope grants access to: either
 * the explicit wallet list, or every farmer profile whose location matches
 * the scoped region (case-insensitive match on city or country).
 */
async function resolveScopedWallets(scope: IntegratorScope): Promise<string[]> {
  if (scope.scopedFarmerWallets.length > 0) {
    return scope.scopedFarmerWallets;
  }
  if (!scope.scopedRegion) {
    return [];
  }
  const region = scope.scopedRegion.toLowerCase();
  const locations = await prisma.location.findMany({
    where: {
      OR: [
        { city: { equals: scope.scopedRegion, mode: "insensitive" } },
        { country: { equals: scope.scopedRegion, mode: "insensitive" } },
      ],
    },
    select: { walletAddress: true, city: true, country: true },
  });
  return locations
    .filter(
      (l) =>
        (l as any).city?.toLowerCase() === region || (l as any).country?.toLowerCase() === region,
    )
    .map((l) => (l as any).walletAddress ?? (l as any).wallet_address);
}

/** Serializes a list of flat records to CSV (Issue #662: CSV + JSON output). */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const escape = (value: unknown): string => {
    const str = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export function ensureNotOverPageLimit(limit: number): void {
  if (limit > MAX_PAGE_SIZE) {
    throw new ApiError(400, "Bad Request", `limit cannot exceed ${MAX_PAGE_SIZE}`);
  }
}
