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
    order: {
      update: vi.fn(),
    },
  },
}));

vi.mock("../supplyService.js", () => ({
  listFarmerSupplies: vi.fn(),
}));

vi.mock("../orderService.js", () => ({
  OrderService: {
    getByOrderId: vi.fn(),
  },
}));

const mockListFarmerSupplies = (await import("../supplyService.js")).listFarmerSupplies as ReturnType<typeof vi.fn>;
const { handleUssdRequest } = await import("./ussdHandler.js");

const SESSION_ID = "sess-1";
const PHONE = "+254700000001";

function makeSession(overrides: Record<string, unknown> = {}) {
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

describe("handleUssdRequest", () => {
  describe("new session", () => {
    it("shows main menu on first request", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(null);
      prisma.ussdSession.create = vi.fn().mockResolvedValueOnce(makeSession());

      const response = await handleUssdRequest(SESSION_ID, PHONE, "");

      expect(response).toContain("CON Welcome to Agrocylo");
      expect(response).toContain("1. List farm supply");
    });
  });

  describe("main_menu", () => {
    it("handles exit (0)", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession());
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());
      prisma.ussdSession.delete = vi.fn().mockResolvedValueOnce(makeSession());

      const response = await handleUssdRequest(SESSION_ID, PHONE, "0");

      expect(response).toBe("END Thank you for using Agrocylo.");
    });

    it("handles invalid choice", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession());
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());

      const response = await handleUssdRequest(SESSION_ID, PHONE, "99");

      expect(response).toContain("Invalid choice");
    });

    it("transitions to list_supply_crop on 1", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession());
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession({ step: "list_supply_crop" }));

      const response = await handleUssdRequest(SESSION_ID, PHONE, "1");

      expect(response).toContain("Enter crop name");
    });

    it("transitions to order_status_id on 2", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession());
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession({ step: "order_status_id" }));

      const response = await handleUssdRequest(SESSION_ID, PHONE, "2");

      expect(response).toContain("Enter your Order ID");
    });

    it("transitions to confirm_receipt_id on 3", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession());
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession({ step: "confirm_receipt_id" }));

      const response = await handleUssdRequest(SESSION_ID, PHONE, "3");

      expect(response).toContain("Enter the Order ID");
    });

    it("transitions to link_wallet on 4", async () => {
      prisma.ussdSession.findUnique = vi.fn().mockResolvedValueOnce(makeSession());
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession({ step: "link_wallet" }));

      const response = await handleUssdRequest(SESSION_ID, PHONE, "4");

      expect(response).toContain("Enter your wallet address");
    });
  });

  describe("link_wallet", () => {
    it("links wallet and returns success", async () => {
      prisma.ussdSession.findUnique = vi
        .fn()
        .mockResolvedValueOnce(makeSession({ step: "link_wallet" }));
      prisma.phoneLink.upsert = vi.fn().mockResolvedValueOnce({});
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession({ walletAddress: "0xabcd1234abcd1234abcd1234abcd1234abcd1234" }));

      const response = await handleUssdRequest(SESSION_ID, PHONE, "0xabcd1234abcd1234abcd1234abcd1234abcd1234");

      expect(response).toContain("Wallet linked");
    });

    it("rejects invalid wallet address", async () => {
      prisma.ussdSession.findUnique = vi
        .fn()
        .mockResolvedValueOnce(makeSession({ step: "link_wallet" }));
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());

      const response = await handleUssdRequest(SESSION_ID, PHONE, "invalid");
      expect(response).toContain("Invalid wallet address");
    });
  });

  describe("list_supply_crop", () => {
    it("returns supplies for a crop", async () => {
      prisma.ussdSession.findUnique = vi
        .fn()
        .mockResolvedValueOnce(makeSession({ step: "list_supply_crop" }));
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());

      mockListFarmerSupplies.mockResolvedValueOnce({
        items: [
          {
            farmerWallet: "0x1111222233334444555566667777888899990000",
            quantityAvailable: "100",
            unit: "kg",
            pricePerUnit: "50",
          },
        ],
        total: 1,
      });

      const response = await handleUssdRequest(SESSION_ID, PHONE, "maize");
      expect(response).toContain("Supplies for maize");
      expect(response).toContain("100 kg @ 50");
    });

    it("returns no supplies message when empty", async () => {
      prisma.ussdSession.findUnique = vi
        .fn()
        .mockResolvedValueOnce(makeSession({ step: "list_supply_crop" }));
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());

      mockListFarmerSupplies.mockResolvedValueOnce({ items: [], total: 0 });

      const response = await handleUssdRequest(SESSION_ID, PHONE, "soybeans");
      expect(response).toContain("No supplies found");
    });
  });

  describe("order_status_id", () => {
    it("shows order status for buyer", async () => {
      prisma.ussdSession.findUnique = vi
        .fn()
        .mockResolvedValueOnce(makeSession({ step: "order_status_id", walletAddress: "0xbuyer" }));
      prisma.phoneLink.findUnique = vi.fn().mockResolvedValueOnce({
        phoneNumber: PHONE,
        walletAddress: "0xbuyer",
      });
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());

      const { OrderService } = await import("../orderService.js");
      (OrderService.getByOrderId as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        orderIdOnChain: "order-123",
        buyerAddress: "0xbuyer",
        sellerAddress: "0xseller",
        amount: "100",
        token: "USDC",
        status: "DELIVERED",
      });

      const response = await handleUssdRequest(SESSION_ID, PHONE, "order-123");

      expect(response).toContain("DELIVERED");
      expect(response).toContain("100 USDC");
    });

    it("shows not found for unauthorized wallet", async () => {
      prisma.ussdSession.findUnique = vi
        .fn()
        .mockResolvedValueOnce(makeSession({ step: "order_status_id", walletAddress: "0xbuyer" }));
      prisma.phoneLink.findUnique = vi.fn().mockResolvedValueOnce({
        phoneNumber: PHONE,
        walletAddress: "0xbuyer",
      });
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());

      const { OrderService } = await import("../orderService.js");
      (OrderService.getByOrderId as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        orderIdOnChain: "order-456",
        buyerAddress: "0xother",
        sellerAddress: "0xother2",
      });

      const response = await handleUssdRequest(SESSION_ID, PHONE, "order-456");
      expect(response).toContain("Order not found");
    });
  });

  describe("confirm_receipt_id", () => {
    it("confirms receipt, updates order, sends SMS", async () => {
      prisma.ussdSession.findUnique = vi
        .fn()
        .mockResolvedValueOnce(makeSession({ step: "confirm_receipt_id", walletAddress: "0xbuyer" }));
      prisma.phoneLink.findUnique = vi.fn().mockResolvedValueOnce({
        phoneNumber: PHONE,
        walletAddress: "0xbuyer",
      });
      prisma.phoneLink.findFirst = vi
        .fn()
        .mockResolvedValueOnce({ phoneNumber: PHONE, walletAddress: "0xbuyer" })
        .mockResolvedValueOnce({ phoneNumber: "+254700000002", walletAddress: "0xseller" });
      prisma.ussdSession.update = vi.fn().mockResolvedValueOnce(makeSession());
      prisma.order.update = vi.fn().mockResolvedValueOnce({});

      const { OrderService } = await import("../orderService.js");
      (OrderService.getByOrderId as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        orderIdOnChain: "order-789",
        buyerAddress: "0xbuyer",
        sellerAddress: "0xseller",
        amount: "50",
        token: "USDC",
        status: "DELIVERED",
      });

      const response = await handleUssdRequest(SESSION_ID, PHONE, "order-789");

      expect(response).toContain("Receipt confirmed");
      expect(prisma.order.update).toHaveBeenCalled();
    });
  });
});
