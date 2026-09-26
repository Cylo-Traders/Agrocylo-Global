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
    order: {
      update: vi.fn(),
    },
  },
}));

vi.mock("./smsAdapter.js", () => ({
  sendSms: vi.fn(),
}));

vi.mock("../supplyService.js", () => ({
  listFarmerSupplies: vi.fn(),
}));

vi.mock("../orderService.js", () => ({
  OrderService: {
    getByOrderId: vi.fn(),
  },
}));

const { handleUssdRequest, isStellarPublicKey } = await import("./ussdHandler.js");
const { listFarmerSupplies } = await import("../supplyService.js");

const mockListFarmerSupplies = listFarmerSupplies as ReturnType<typeof vi.fn>;

const SESSION_ID = "test-session-100";
const PHONE = "+254700000001";
const STELLAR_WALLET = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA64PWBTRKZA";

function makeSession(overrides = {}) {
  return {
    id: "sess-1",
    sessionId: SESSION_ID,
    phoneNumber: PHONE,
    step: "main_menu",
    state: {},
    walletAddress: null,
    expiresAt: new Date(Date.now() + 600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isStellarPublicKey", () => {
  it("validates Stellar G... public keys", () => {
    expect(isStellarPublicKey(STELLAR_WALLET)).toBe(true);
    expect(isStellarPublicKey("0x1234567890123456789012345678901234567890")).toBe(false);
    expect(isStellarPublicKey("G123")).toBe(false);
  });
});

describe("handleUssdRequest", () => {
  describe("session hijacking / phone mismatch", () => {
    it("throws error when session phone does not match incoming phone", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession({ phoneNumber: "+254700000001" }));
      await expect(handleUssdRequest(SESSION_ID, "+254799999999", "1")).rejects.toThrow("Session phone number mismatch");
    });
  });

  describe("new session", () => {
    it("creates a new session and returns main menu", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(null);
      prisma.ussdSession.create = vi.fn().mockResolvedValueOnce(makeSession());

      const response = await handleUssdRequest(SESSION_ID, PHONE, "");

      expect(response).toContain("Welcome to Agrocylo");
      expect(response).toContain("1. List farm supply");
    });
  });

  describe("link_wallet", () => {
    it("links wallet unverified and returns verification required message", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession({ step: "link_wallet" }));
      prisma.phoneLink.upsert = vi.fn().mockResolvedValueOnce({});
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession({ walletAddress: STELLAR_WALLET }));

      const response = await handleUssdRequest(SESSION_ID, PHONE, STELLAR_WALLET);

      expect(response).toContain("Wallet link requested");
      expect(prisma.phoneLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ verifiedAt: null }),
        })
      );
    });

    it("rejects non-Stellar wallet address", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession({ step: "link_wallet" }));
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());

      const response = await handleUssdRequest(SESSION_ID, PHONE, "0x1234567890123456789012345678901234567890");
      expect(response).toContain("Invalid Stellar address");
    });
  });

  describe("order_status_id", () => {
    it("rejects order status query if wallet is unverified", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession({ step: "order_status_id" }));
      prisma.phoneLink.findUnique = vi.fn().mockResolvedValueOnce({
        phoneNumber: PHONE,
        walletAddress: STELLAR_WALLET,
        verifiedAt: null,
      });
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());

      const response = await handleUssdRequest(SESSION_ID, PHONE, "order-123");
      expect(response).toContain("No verified wallet linked");
    });

    it("shows order status for verified wallet", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession({ step: "order_status_id" }));
      prisma.phoneLink.findUnique = vi.fn().mockResolvedValueOnce({
        phoneNumber: PHONE,
        walletAddress: STELLAR_WALLET,
        verifiedAt: new Date(),
      });
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());

      const { OrderService } = await import("../orderService.js");
      (OrderService.getByOrderId as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        orderIdOnChain: "order-123",
        buyerAddress: STELLAR_WALLET,
        sellerAddress: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA64PWBTRKZA",
        amount: "100",
        token: "USDC",
        status: "DELIVERED",
      });

      const response = await handleUssdRequest(SESSION_ID, PHONE, "order-123");
      expect(response).toContain("DELIVERED");
    });
  });
});
