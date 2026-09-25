import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "../../config/database.js";

vi.mock("../../config/database.js", () => ({
  prisma: {
    ussdSession: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    phoneLink: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const {
  getSession,
  createSession,
  updateSession,
  deleteSession,
  getWalletByPhone,
  getPhoneByWallet,
  linkPhoneToWallet,
  verifyPhoneLink,
} = await import("./sessionStore.js");

const mockFindUnique = prisma.ussdSession.findUnique as ReturnType<typeof vi.fn>;
const mockCreate = prisma.ussdSession.create as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.ussdSession.update as ReturnType<typeof vi.fn>;
const mockDelete = prisma.ussdSession.delete as ReturnType<typeof vi.fn>;
const mockPhoneFindUnique = prisma.phoneLink.findUnique as ReturnType<typeof vi.fn>;
const mockPhoneFindFirst = prisma.phoneLink.findFirst as ReturnType<typeof vi.fn>;
const mockPhoneUpsert = prisma.phoneLink.upsert as ReturnType<typeof vi.fn>;
const mockPhoneUpdate = prisma.phoneLink.update as ReturnType<typeof vi.fn>;

const STELLAR_WALLET = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA64PWBTRKZA";

const SAMPLE_SESSION = {
  id: "sess-1",
  sessionId: "test-session-1",
  phoneNumber: "+254700000001",
  step: "main_menu",
  state: {},
  walletAddress: null,
  expiresAt: new Date(Date.now() + 600_000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSession", () => {
  it("returns session when found and not expired", async () => {
    mockFindUnique.mockResolvedValueOnce(SAMPLE_SESSION);
    const result = await getSession("test-session-1");
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("test-session-1");
  });

  it("returns null when session is not found", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await getSession("nonexistent");
    expect(result).toBeNull();
  });

  it("deletes and returns null for expired session", async () => {
    const expired = {
      ...SAMPLE_SESSION,
      expiresAt: new Date(Date.now() - 60_000),
    };
    mockFindUnique.mockResolvedValueOnce(expired as any);
    mockDelete.mockResolvedValueOnce(expired as any);
    const result = await getSession("expired-session");
    expect(result).toBeNull();
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "sess-1" } });
  });
});

describe("createSession", () => {
  it("creates a new session with default step", async () => {
    mockCreate.mockResolvedValueOnce(SAMPLE_SESSION);
    const result = await createSession("test-session-1", "+254700000001");
    expect(result.sessionId).toBe("test-session-1");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: "test-session-1",
          phoneNumber: "+254700000001",
          step: "main_menu",
        }),
      }),
    );
  });

  it("creates a new session with custom step", async () => {
    mockCreate.mockResolvedValueOnce({ ...SAMPLE_SESSION, step: "link_wallet" });
    const result = await createSession("test-session-2", "+254700000002", "link_wallet");
    expect(result.step).toBe("link_wallet");
  });
});

describe("updateSession", () => {
  it("updates step", async () => {
    mockUpdate.mockResolvedValueOnce({ ...SAMPLE_SESSION, step: "list_supply_crop" });
    const result = await updateSession("test-session-1", { step: "list_supply_crop" });
    expect(result.step).toBe("list_supply_crop");
  });

  it("updates walletAddress", async () => {
    mockUpdate.mockResolvedValueOnce({
      ...SAMPLE_SESSION,
      walletAddress: STELLAR_WALLET,
    });
    const result = await updateSession("test-session-1", {
      walletAddress: STELLAR_WALLET,
    });
    expect(result.walletAddress).toBe(STELLAR_WALLET);
  });
});

describe("deleteSession", () => {
  it("deletes session by sessionId", async () => {
    mockDelete.mockResolvedValueOnce(SAMPLE_SESSION);
    await deleteSession("test-session-1");
    expect(mockDelete).toHaveBeenCalledWith({ where: { sessionId: "test-session-1" } });
  });

  it("does not throw when session does not exist", async () => {
    mockDelete.mockRejectedValueOnce(new Error("Not found"));
    await expect(deleteSession("nonexistent")).resolves.toBeUndefined();
  });
});

describe("getWalletByPhone", () => {
  it("returns wallet address when phone is linked and verified", async () => {
    mockPhoneFindUnique.mockResolvedValueOnce({
      phoneNumber: "+254700000001",
      walletAddress: STELLAR_WALLET,
      verifiedAt: new Date(),
    });
    const result = await getWalletByPhone("+254700000001", true);
    expect(result).toBe(STELLAR_WALLET);
  });

  it("returns null when phone is linked but unverified and verification required", async () => {
    mockPhoneFindUnique.mockResolvedValueOnce({
      phoneNumber: "+254700000001",
      walletAddress: STELLAR_WALLET,
      verifiedAt: null,
    });
    const result = await getWalletByPhone("+254700000001", true);
    expect(result).toBeNull();
  });

  it("returns null when phone is not linked", async () => {
    mockPhoneFindUnique.mockResolvedValueOnce(null);
    const result = await getWalletByPhone("+254700099999");
    expect(result).toBeNull();
  });
});

describe("getPhoneByWallet", () => {
  it("returns phone number for wallet when verified", async () => {
    mockPhoneFindFirst.mockResolvedValueOnce({
      phoneNumber: "+254700000001",
      walletAddress: STELLAR_WALLET,
      verifiedAt: new Date(),
    });
    const result = await getPhoneByWallet(STELLAR_WALLET, true);
    expect(result).toBe("+254700000001");
  });

  it("returns null when wallet is linked but unverified", async () => {
    mockPhoneFindFirst.mockResolvedValueOnce({
      phoneNumber: "+254700000001",
      walletAddress: STELLAR_WALLET,
      verifiedAt: null,
    });
    const result = await getPhoneByWallet(STELLAR_WALLET, true);
    expect(result).toBeNull();
  });

  it("returns null when wallet has no linked phone", async () => {
    mockPhoneFindFirst.mockResolvedValueOnce(null);
    const result = await getPhoneByWallet("GNONEXISTENT");
    expect(result).toBeNull();
  });
});

describe("linkPhoneToWallet", () => {
  it("creates an unverified link by default", async () => {
    mockPhoneUpsert.mockResolvedValueOnce({
      phoneNumber: "+254700000001",
      walletAddress: STELLAR_WALLET,
      verifiedAt: null,
    });
    await linkPhoneToWallet("+254700000001", STELLAR_WALLET);
    expect(mockPhoneUpsert).toHaveBeenCalledWith({
      where: { phoneNumber: "+254700000001" },
      create: { phoneNumber: "+254700000001", walletAddress: STELLAR_WALLET, verifiedAt: null },
      update: { walletAddress: STELLAR_WALLET, verifiedAt: null },
    });
  });

  it("creates a verified link when specified", async () => {
    mockPhoneUpsert.mockResolvedValueOnce({});
    await linkPhoneToWallet("+254700000001", STELLAR_WALLET, true);
    expect(mockPhoneUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ verifiedAt: expect.any(Date) }),
      })
    );
  });
});

describe("verifyPhoneLink", () => {
  it("updates verifiedAt timestamp", async () => {
    mockPhoneUpdate.mockResolvedValueOnce({});
    await verifyPhoneLink("+254700000001");
    expect(mockPhoneUpdate).toHaveBeenCalledWith({
      where: { phoneNumber: "+254700000001" },
      data: { verifiedAt: expect.any(Date) },
    });
  });
});
