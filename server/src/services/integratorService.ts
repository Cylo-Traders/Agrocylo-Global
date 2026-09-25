import crypto from "node:crypto";
import { prisma } from "../config/database.js";
import { ApiError, NotFoundError, ValidationError } from "../http/errors.js";
import { hashApiKey } from "../middleware/integratorAuth.js";
import { CampaignStatus, OrderStatus } from "../constants/status.js";

export interface IntegratorScope {
  organizationName: string;
  scopedFarmerWallets: string[];
  scopedRegion: string | null;
}

/** Bounded report pagination: limit + stable keyset cursor over farmer wallets. */
export interface ReportQuery {
  limit?: number;
  cursor?: string;
}

export interface ReportResult {
  rows: Array<Record<string, unknown>>;
  next_cursor: string | null;
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_REPORT_LIMIT = 100;
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
    const validated = ensureNotOverPageLimit(limit);
    return prisma.integratorApiKeyUsage.findMany({
      where: { apiKeyId: keyId },
      orderBy: { requestedAt: "desc" },
      take: validated,
    });
  }

  /**
   * Aggregate, org-scoped farmer report. Returns only what the scoping
   * organization is entitled to: farmer identity + region, and coarse
   * production activity counts — no wallet-level financial detail such as
   * individual order amounts or campaign investment balances (Issue #662).
   * Pagination is applied in the database (Issue #969): only the requested
   * page of profiles is loaded and campaign counts are fetched for that page's
   * wallets alone, so a small page never streams the whole org into memory.
   */
  static async getFarmerReport(scope: IntegratorScope, query: ReportQuery = {}): Promise<ReportResult> {
    const limit = ensureNotOverPageLimit(query.limit ?? DEFAULT_REPORT_LIMIT);
    const cursor = query.cursor;
    const wallets = await resolveScopedWallets(scope);
    if (wallets.length === 0) return { rows: [], next_cursor: null };

    const profiles = await prisma.profile.findMany({
      where: {
        walletAddress: { in: wallets, ...(cursor ? { gt: cursor } : {}) },
        role: "FARMER",
      },
      include: { location: true },
      orderBy: { walletAddress: "asc" },
      take: limit + 1,
    });

    const hasMore = profiles.length > limit;
    const pageProfiles = profiles.slice(0, limit);

    const pageWallets = pageProfiles.map((p) => (p as any).walletAddress ?? (p as any).wallet_address);

    let campaigns: Awaited<ReturnType<typeof prisma.campaign.findMany>> = [];
    if (pageWallets.length > 0) {
      campaigns = await prisma.campaign.findMany({
        where: { creatorAddress: { in: pageWallets } },
      });
    }

    const campaignsByFarmer = new Map<string, typeof campaigns>();
    for (const c of campaigns) {
      const list = campaignsByFarmer.get(c.creatorAddress) ?? [];
      list.push(c);
      campaignsByFarmer.set(c.creatorAddress, list);
    }

    const rows = pageProfiles.map((p) => {
      const farmerWallet = (p as any).walletAddress ?? (p as any).wallet_address;
      const farmerCampaigns = campaignsByFarmer.get(farmerWallet) ?? [];
      return {
        farmerWallet,
        displayName: p.name ?? null,
        region: p.location ? [p.location.city, p.location.country].filter(Boolean).join(", ") : null,
        totalCampaigns: farmerCampaigns.length,
        settledCampaigns: farmerCampaigns.filter((c) => c.status === CampaignStatus.SETTLED).length,
        activeCampaigns: farmerCampaigns.filter((c) => c.status === CampaignStatus.ACTIVE).length,
      };
    });

    const last = rows.at(-1);

    return {
      rows,
      next_cursor: hasMore && last ? String(last.farmerWallet) : null,
    };
  }

  /**
   * Aggregate, org-scoped order report. Counts and status breakdown only —
   * no buyer identity or per-order monetary amount, consistent with "no
   * PII/wallet-level financial detail beyond what the scoping organization
   * is entitled to" (Issue #662). The distinct seller list is paged with a
   * stable keyset cursor in the database and status counts are aggregated
   * server-side via groupBy (Issue #969).
   */
  static async getOrderReport(scope: IntegratorScope, query: ReportQuery = {}): Promise<ReportResult> {
    const limit = ensureNotOverPageLimit(query.limit ?? DEFAULT_REPORT_LIMIT);
    const cursor = query.cursor;
    const wallets = await resolveScopedWallets(scope);
    if (wallets.length === 0) return { rows: [], next_cursor: null };

    const sellers = await prisma.order.findMany({
      where: {
        sellerAddress: { in: wallets, ...(cursor ? { gt: cursor } : {}) },
      },
      distinct: ["sellerAddress"],
      orderBy: { sellerAddress: "asc" },
      take: limit + 1,
    });

    const hasMore = sellers.length > limit;
    const pageSellers = sellers.slice(0, limit);
    const sellerAddresses = pageSellers.map((o) => o.sellerAddress);

    type StatusCount = { sellerAddress: string; status: string; count: number };
    let counts: StatusCount[] = [];
    if (sellerAddresses.length > 0) {
      const grouped = await prisma.order.groupBy({
        by: ["sellerAddress", "status"],
        where: { sellerAddress: { in: sellerAddresses } },
        _count: { _all: true },
      });
      counts = grouped.map((g) => ({
        sellerAddress: g.sellerAddress,
        status: g.status,
        count: g._count._all,
      }));
    }

    const bySeller = new Map<string, { total: number; completed: number; refunded: number; pending: number }>();
    for (const c of counts) {
      const entry = bySeller.get(c.sellerAddress) ?? { total: 0, completed: 0, refunded: 0, pending: 0 };
      entry.total += c.count;
      if (c.status === OrderStatus.COMPLETED) entry.completed += c.count;
      else if (c.status === OrderStatus.REFUNDED) entry.refunded += c.count;
      else entry.pending += c.count;
      bySeller.set(c.sellerAddress, entry);
    }

    const rows = sellerAddresses.map((sellerAddress) => ({
      farmerWallet: sellerAddress,
      ...(bySeller.get(sellerAddress) ?? { total: 0, completed: 0, refunded: 0, pending: 0 }),
    }));

    const last = rows.at(-1);

    return {
      rows,
      next_cursor: hasMore && last ? String(last.farmerWallet) : null,
    };
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

/**
 * Spreadsheet formula injection prefixes (Issue #968): =, +, -, @ and leading
 * tab/CR. Cells starting with any of these are neutralized to plain text so
 * opening a partner report in a spreadsheet cannot interpret farmer-supplied
 * names or locations as formulas/macros.
 */
const SPREADSHEET_FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Serializes a list of flat records to CSV (Issue #662: CSV + JSON output). */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const escape = (value: unknown): string => {
    // Legitimate numeric report fields keep their numeric meaning.
    if (typeof value === "number") return String(value);
    const str = value === null || value === undefined ? "" : String(value);
    const sanitized = SPREADSHEET_FORMULA_PREFIX.test(str) ? `'${str}` : str;
    if (/[",\n]/.test(sanitized)) {
      return `"${sanitized.replace(/"/g, '""')}"`;
    }
    return sanitized;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export function ensureNotOverPageLimit(limit: number): number {
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    throw new ApiError(400, "Bad Request", "limit must be a positive integer");
  }
  if (limit > MAX_PAGE_SIZE) {
    throw new ApiError(400, "Bad Request", `limit cannot exceed ${MAX_PAGE_SIZE}`);
  }
  return limit;
}
