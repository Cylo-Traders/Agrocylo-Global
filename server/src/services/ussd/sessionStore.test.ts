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
} = await import("./sessionStore.js");

const mockFindUnique = prisma.ussdSession.findUnique as ReturnType<typeof vi.fn>;
const mockCreate = prisma.ussdSession.create as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.ussdSession.update as ReturnType<typeof vi.fn>;
const mockDelete = prisma.ussdSession.delete as ReturnType<typeof vi.fn>;
const mockPhoneFindUnique = prisma.phoneLink.findUnique as ReturnType<typeof vi.fn>;
const mockPhoneFindFirst = prisma.phoneLink.findFirst as ReturnType<typeof vi.fn>;
const mockPhoneUpsert = prisma.phoneLink.upsert as ReturnType<typeof vi.fn>;

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
      walletAddress: "0xabc123",
    });
    const result = await updateSession("test-session-1", {
      walletAddress: "0xabc123",
    });
    expect(result.walletAddress).toBe("0xabc123");
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
  it("returns wallet address when phone is linked", async () => {
    mockPhoneFindUnique.mockResolvedValueOnce({
      phoneNumber: "+254700000001",
      walletAddress: "0xabc",
    });
    const result = await getWalletByPhone("+254700000001");
    expect(result).toBe("0xabc");
  });

  it("returns null when phone is not linked", async () => {
    mockPhoneFindUnique.mockResolvedValueOnce(null);
    const result = await getWalletByPhone("+254700099999");
    expect(result).toBeNull();
  });
});

describe("getPhoneByWallet", () => {
  it("returns phone number for wallet", async () => {
    mockPhoneFindFirst.mockResolvedValueOnce({
      phoneNumber: "+254700000001",
      walletAddress: "0xabc",
    });
    const result = await getPhoneByWallet("0xabc");
    expect(result).toBe("+254700000001");
  });

  it("returns null when wallet has no linked phone", async () => {
    mockPhoneFindFirst.mockResolvedValueOnce(null);
    const result = await getPhoneByWallet("0xnonexistent");
    expect(result).toBeNull();
  });
});

describe("linkPhoneToWallet", () => {
  it("creates a new link", async () => {
    mockPhoneUpsert.mockResolvedValueOnce({
      phoneNumber: "+254700000001",
      walletAddress: "0xabc",
    });
    await linkPhoneToWallet("+254700000001", "0xabc");
    expect(mockPhoneUpsert).toHaveBeenCalledWith({
      where: { phoneNumber: "+254700000001" },
      create: { phoneNumber: "+254700000001", walletAddress: "0xabc" },
      update: { walletAddress: "0xabc" },
    });
  });
});
