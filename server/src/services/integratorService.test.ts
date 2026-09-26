import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/database.js", () => ({
  prisma: {
    integratorApiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    integratorApiKeyUsage: {
      findMany: vi.fn(),
    },
    profile: {
      findMany: vi.fn(),
    },
    campaign: {
      findMany: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    location: {
      findMany: vi.fn(),
    },
  },
}));

import { IntegratorService, toCsv, ensureNotOverPageLimit } from "./integratorService.js";
import { prisma } from "../config/database.js";

const mockApiKey = vi.mocked(prisma.integratorApiKey);
const mockProfile = vi.mocked(prisma.profile);
const mockCampaign = vi.mocked(prisma.campaign);
const mockOrder = vi.mocked(prisma.order);
const mockLocation = vi.mocked(prisma.location);
const mockUsage = vi.mocked(prisma.integratorApiKeyUsage);

const farmerScope = {
  organizationName: "Cyprus Coop",
  scopedFarmerWallets: ["GFARMER1"],
  scopedRegion: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IntegratorService.issueKey", () => {
  it("rejects a key with neither farmer wallets nor a region", async () => {
    await expect(
      IntegratorService.issueKey({ organizationName: "Cyprus Coop", createdByAdmin: "GADMIN" }),
    ).rejects.toThrow();
    expect(mockApiKey.create).not.toHaveBeenCalled();
  });

  it("issues a key scoped to explicit farmer wallets and returns the raw key once", async () => {
    mockApiKey.create.mockResolvedValueOnce({
      id: "k1",
      keyHash: "hash",
      keyPrefix: "agc_abcdef12",
      organizationName: "Cyprus Coop",
      scopedFarmerWallets: ["GFARMER1"],
      scopedRegion: null,
      createdByAdmin: "GADMIN",
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    } as any);

    const result = await IntegratorService.issueKey({
      organizationName: "Cyprus Coop",
      scopedFarmerWallets: ["GFARMER1"],
      createdByAdmin: "GADMIN",
    });

    expect(result.rawKey).toMatch(/^agc_/);
    expect(mockApiKey.create).toHaveBeenCalledTimes(1);
  });
});

describe("IntegratorService.revokeKey", () => {
  it("throws NotFoundError for an unknown key id", async () => {
    mockApiKey.findUnique.mockResolvedValueOnce(null);
    await expect(IntegratorService.revokeKey("missing")).rejects.toThrow();
  });

  it("is idempotent for an already-revoked key", async () => {
    const revoked = { id: "k1", revokedAt: new Date() };
    mockApiKey.findUnique.mockResolvedValueOnce(revoked as any);
    const result = await IntegratorService.revokeKey("k1");
    expect(result).toEqual(revoked);
    expect(mockApiKey.update).not.toHaveBeenCalled();
  });
});

describe("IntegratorService.getUsageLog", () => {
  it("uses a validated limit for the usage log query", async () => {
    mockUsage.findMany.mockResolvedValueOnce([]);

    await IntegratorService.getUsageLog("k1", 10);

    expect(mockUsage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });
});

describe("IntegratorService.getFarmerReport", () => {
  it("returns no rows and never queries profiles when scope resolves to no wallets", async () => {
    const result = await IntegratorService.getFarmerReport({
      organizationName: "Cyprus Coop",
      scopedFarmerWallets: [],
      scopedRegion: null,
    });
    expect(result.rows).toEqual([]);
    expect(result.next_cursor).toBeNull();
    expect(mockProfile.findMany).not.toHaveBeenCalled();
  });

  it("aggregates campaign counts per farmer without leaking financial detail", async () => {
    mockProfile.findMany.mockResolvedValueOnce([
      { wallet_address: "GFARMER1", name: "Farm A", location: { city: "Nicosia", country: "Cyprus" } },
    ] as any);
    mockCampaign.findMany.mockResolvedValueOnce([
      { creatorAddress: "GFARMER1", status: "SETTLED" },
      { creatorAddress: "GFARMER1", status: "ACTIVE" },
    ] as any);

    const result = await IntegratorService.getFarmerReport(farmerScope);

    expect(result.next_cursor).toBeNull();
    expect(result.rows).toEqual([
      {
        farmerWallet: "GFARMER1",
        displayName: "Farm A",
        region: "Nicosia, Cyprus",
        totalCampaigns: 2,
        settledCampaigns: 1,
        activeCampaigns: 1,
      },
    ]);
    // No order amounts, buyer addresses, or investment balances present.
    expect(JSON.stringify(result.rows)).not.toMatch(/amount|buyer|investment/i);
  });

  it("resolves region-scoped keys via matching location city/country", async () => {
    mockLocation.findMany.mockResolvedValueOnce([
      { wallet_address: "GFARMER2", city: "Nicosia", country: "Cyprus" },
    ] as any);
    mockProfile.findMany.mockResolvedValueOnce([]);

    await IntegratorService.getFarmerReport({
      organizationName: "Cyprus Coop",
      scopedFarmerWallets: [],
      scopedRegion: "Nicosia",
    });

    expect(mockProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ walletAddress: { in: ["GFARMER2"] } }),
      }),
    );
  });

  it("pages farmers in the database and returns a stable next_cursor", async () => {
    mockProfile.findMany.mockResolvedValueOnce(
      Array.from({ length: 4 }, (_, i) => ({
        wallet_address: `GFARMER${i + 1}`,
        name: `Farm ${i + 1}`,
        location: { city: "Nicosia", country: "Cyprus" },
      })) as any,
    );
    mockCampaign.findMany.mockResolvedValueOnce([]);

    const result = await IntegratorService.getFarmerReport(farmerScope, { limit: 2 });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.farmerWallet).toBe("GFARMER1");
    expect(result.rows[1]!.farmerWallet).toBe("GFARMER2");
    expect(result.next_cursor).toBe("GFARMER2");
    // Campaign counts are fetched only for the page's wallets — not the whole org.
    expect(mockCampaign.findMany).toHaveBeenCalledWith({
      where: { creatorAddress: { in: ["GFARMER1", "GFARMER2"] } },
    });
    expect(mockProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { walletAddress: "asc" }, take: 3 }),
    );
  });

  it("supports keyset pagination from a previous page cursor", async () => {
    mockProfile.findMany.mockResolvedValueOnce([{ wallet_address: "GFARMER3" }] as any);
    mockCampaign.findMany.mockResolvedValueOnce([]);

    const result = await IntegratorService.getFarmerReport(farmerScope, {
      limit: 2,
      cursor: "GFARMER2",
    });

    expect(result.rows).toEqual([{ farmerWallet: "GFARMER3", displayName: null, region: null, totalCampaigns: 0, settledCampaigns: 0, activeCampaigns: 0 }]);
    expect(mockProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ walletAddress: expect.objectContaining({ gt: "GFARMER2" }) }),
      }),
    );
  });
});

describe("IntegratorService.getOrderReport", () => {
  it("aggregates status counts per farmer without buyer identity or amounts", async () => {
    mockOrder.findMany.mockResolvedValueOnce([
      { sellerAddress: "GFARMER1" },
    ] as any);
    mockOrder.groupBy.mockResolvedValueOnce([
      { sellerAddress: "GFARMER1", status: "COMPLETED", _count: { _all: 1 } },
      { sellerAddress: "GFARMER1", status: "PENDING", _count: { _all: 1 } },
      { sellerAddress: "GFARMER1", status: "REFUNDED", _count: { _all: 1 } },
    ] as any);

    const result = await IntegratorService.getOrderReport(farmerScope);

    expect(result.rows).toEqual([{ farmerWallet: "GFARMER1", total: 3, completed: 1, refunded: 1, pending: 1 }]);
    expect(result.next_cursor).toBeNull();
  });

  it("pages sellers in the database with a stable cursor and bounded count aggregation", async () => {
    mockOrder.findMany.mockResolvedValueOnce([
      { sellerAddress: "GA" },
      { sellerAddress: "GB" },
      { sellerAddress: "GC" },
    ] as any);
    mockOrder.groupBy.mockResolvedValueOnce([
      { sellerAddress: "GA", status: "COMPLETED", _count: { _all: 2 } },
      { sellerAddress: "GB", status: "PENDING", _count: { _all: 1 } },
    ] as any);

    const result = await IntegratorService.getOrderReport(farmerScope, { limit: 2 });

    expect(result.rows).toEqual([
      { farmerWallet: "GA", total: 2, completed: 2, refunded: 0, pending: 0 },
      { farmerWallet: "GB", total: 1, completed: 0, refunded: 0, pending: 1 },
    ]);
    expect(result.next_cursor).toBe("GB");
    expect(mockOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ["sellerAddress"], orderBy: { sellerAddress: "asc" }, take: 3 }),
    );
    expect(mockOrder.groupBy).toHaveBeenCalledWith({
      by: ["sellerAddress", "status"],
      where: { sellerAddress: { in: ["GA", "GB"] } },
      _count: { _all: true },
    });
  });
});

describe("ensureNotOverPageLimit", () => {
  it("rejects invalid, zero, negative, fractional and nonnumeric limits", () => {
    expect(() => ensureNotOverPageLimit(NaN)).toThrow();
    expect(() => ensureNotOverPageLimit(0)).toThrow();
    expect(() => ensureNotOverPageLimit(-1)).toThrow();
    expect(() => ensureNotOverPageLimit(1.5)).toThrow();
    expect(() => ensureNotOverPageLimit(201)).toThrow();
  });

  it("accepts finite positive integer limits up to the maximum", () => {
    expect(ensureNotOverPageLimit(1)).toBe(1);
    expect(ensureNotOverPageLimit(200)).toBe(200);
  });
});

describe("toCsv", () => {
  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("serializes headers and escapes commas/quotes", () => {
    const csv = toCsv([{ name: "Farm, A", note: 'has "quotes"' }]);
    expect(csv).toBe('name,note\n"Farm, A","has ""quotes"""');
  });

  it("neutralizes spreadsheet formula prefixes as literal text", () => {
    const csv = toCsv([
      { name: "=1+1", plus: "+concat(a1,b1)", minus: "-2+3", at: "@SUM(A1)", tab: "\t=DDE()", cr: "\r=CMD()" },
    ]);

    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+concat(a1,b1)");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain("'\t=DDE()");
    expect(csv).toContain("'\r=CMD()");
  });

  it("round-trips ordinary names, commas, quotes and multiline text", () => {
    const csv = toCsv([{ name: "Sunrise Coop", note: 'has "quotes"', multiline: "line1\nline2" }]);
    expect(csv).toBe('name,note,multiline\nSunrise Coop,"has ""quotes""","line1\nline2"');
  });

  it("keeps legitimate numeric report fields numeric", () => {
    const csv = toCsv([{ farmerWallet: "GFARMER1", totalCampaigns: 5, refunded: 0 }]);
    expect(csv).toBe("farmerWallet,totalCampaigns,refunded\nGFARMER1,5,0");
  });

  it("preserves negative numeric values, including after quoting", () => {
    const csv = toCsv([{ farmerWallet: "GFARMER1", delta: -3 }]);
    expect(csv).toBe("farmerWallet,delta\nGFARMER1,-3");
  });
});