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
    },
    location: {
      findMany: vi.fn(),
    },
  },
}));

import { IntegratorService, toCsv } from "./integratorService.js";
import { prisma } from "../config/database.js";

const mockApiKey = vi.mocked(prisma.integratorApiKey);
const mockProfile = vi.mocked(prisma.profile);
const mockCampaign = vi.mocked(prisma.campaign);
const mockOrder = vi.mocked(prisma.order);
const mockLocation = vi.mocked(prisma.location);

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

describe("IntegratorService.getFarmerReport", () => {
  it("returns no rows and never queries profiles when scope resolves to no wallets", async () => {
    const rows = await IntegratorService.getFarmerReport({
      organizationName: "Cyprus Coop",
      scopedFarmerWallets: [],
      scopedRegion: null,
    });
    expect(rows).toEqual([]);
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

    const rows = await IntegratorService.getFarmerReport({
      organizationName: "Cyprus Coop",
      scopedFarmerWallets: ["GFARMER1"],
      scopedRegion: null,
    });

    expect(rows).toEqual([
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
    expect(JSON.stringify(rows)).not.toMatch(/amount|buyer|investment/i);
  });

  it("resolves region-scoped keys via matching location city/country", async () => {
    mockLocation.findMany.mockResolvedValueOnce([
      { wallet_address: "GFARMER2", city: "Nicosia", country: "Cyprus" },
    ] as any);
    mockProfile.findMany.mockResolvedValueOnce([]);
    mockCampaign.findMany.mockResolvedValueOnce([]);

    await IntegratorService.getFarmerReport({
      organizationName: "Cyprus Coop",
      scopedFarmerWallets: [],
      scopedRegion: "Nicosia",
    });

    expect(mockProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ wallet_address: { in: ["GFARMER2"] } }),
      }),
    );
  });
});

describe("IntegratorService.getOrderReport", () => {
  it("aggregates status counts per farmer without buyer identity or amounts", async () => {
    mockOrder.findMany.mockResolvedValueOnce([
      { sellerAddress: "GFARMER1", status: "COMPLETED", createdAt: new Date() },
      { sellerAddress: "GFARMER1", status: "PENDING", createdAt: new Date() },
      { sellerAddress: "GFARMER1", status: "REFUNDED", createdAt: new Date() },
    ] as any);

    const rows = await IntegratorService.getOrderReport({
      organizationName: "Cyprus Coop",
      scopedFarmerWallets: ["GFARMER1"],
      scopedRegion: null,
    });

    expect(rows).toEqual([{ farmerWallet: "GFARMER1", total: 3, completed: 1, refunded: 1, pending: 1 }]);
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
});
