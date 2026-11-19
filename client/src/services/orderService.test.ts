import { describe, expect, it, vi, beforeEach } from "vitest";

import { ApiRequestError, apiRequest } from "@/lib/apiHelper";
import {
  listAllOrders,
  listOrdersAsBuyer,
  listOrdersAsSeller,
  mapServerOrder,
} from "./orderService";

vi.mock("@/lib/apiHelper", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/apiHelper")>();
  return { ...actual, apiRequest: vi.fn() };
});

const mockApiRequest = vi.mocked(apiRequest);

const BUYER = "GBUYER";
const SELLER = "GSELLER";

const SERVER_ROW = {
  orderIdOnChain: "42",
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  amount: "700000000",
  status: "PENDING",
  createdAt: "2026-10-18T10:00:00.000Z",
  txHash: "ABCDEF",
};

describe("orderService row mapping (#1184)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a server row into the client Order shape", () => {
    const order = mapServerOrder(SERVER_ROW);

    expect(order.orderId).toBe("42");
    expect(order.buyer).toBe(BUYER);
    expect(order.seller).toBe(SELLER);
    expect(order.amount).toBe(700000000n);
    expect(order.status).toBe("Pending");
    expect(order.createdAt).toBe(
      Math.floor(Date.parse("2026-10-18T10:00:00.000Z") / 1000),
    );
    expect(order.txHash).toBe("ABCDEF");
  });

  it("normalizes numeric amounts, epoch-millis dates and mixed-case status", () => {
    const order = mapServerOrder({
      ...SERVER_ROW,
      amount: 100000000,
      status: "pEnDiNg",
      createdAt: 1760772000000,
    });

    expect(order.amount).toBe(100000000n);
    expect(order.status).toBe("Pending");
    expect(order.createdAt).toBe(1760772000);
  });

  it("tolerates missing fields without throwing", () => {
    const order = mapServerOrder({});
    expect(order.orderId).toBe("");
    expect(order.buyer).toBe("");
    expect(order.seller).toBe("");
    expect(order.amount).toBe(0n);
    expect(order.status).toBe("");
    expect(order.createdAt).toBe(0);
  });
});

describe("authenticated order fetching (#1184)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("requests the seller endpoint for the connected wallet", async () => {
    mockApiRequest.mockResolvedValue([SERVER_ROW]);

    const orders = await listOrdersAsSeller(SELLER);

    expect(mockApiRequest).toHaveBeenCalledWith(`/orders/seller/${SELLER}`);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ seller: SELLER, status: "Pending" });
  });

  it("requests the buyer endpoint for the connected wallet", async () => {
    mockApiRequest.mockResolvedValue([SERVER_ROW]);

    const orders = await listOrdersAsBuyer(BUYER);

    expect(mockApiRequest).toHaveBeenCalledWith(`/orders/buyer/${BUYER}`);
    expect(orders[0]?.buyer).toBe(BUYER);
  });

  it("returns an empty list quietly on 401/403 instead of throwing", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError({
        code: "FORBIDDEN",
        message: "You may only access your own orders",
        status: 403,
      }),
    );

    await expect(listOrdersAsSeller(SELLER)).resolves.toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("throws on server errors so the error UI can render", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError({
        code: "SERVER_ERROR",
        message: "boom",
        status: 500,
      }),
    );

    await expect(listAllOrders()).rejects.toThrow("boom");
  });

  it("wraps a non-array payload as an empty list", async () => {
    mockApiRequest.mockResolvedValue({ unexpected: true });
    await expect(listOrdersAsSeller(SELLER)).resolves.toEqual([]);
  });
});
