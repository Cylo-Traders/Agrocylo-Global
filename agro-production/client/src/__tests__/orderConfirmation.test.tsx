import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildConfirmOrder: vi.fn(),
  signAndSubmitTransaction: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/lib/contractService", () => ({
  buildConfirmOrder: mocks.buildConfirmOrder,
}));
vi.mock("@/lib/signTransaction", () => ({
  signAndSubmitTransaction: mocks.signAndSubmitTransaction,
}));
vi.mock("@/lib/apiClient", () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch },
}));

import { confirmOrderReceipt, createOrder } from "@/services/orderService";
import type { Order } from "@/types";

const buyer =
  "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU";
const order = {
  id: "db-order-1",
  onChainId: "42",
  campaignId: "campaign-1",
  buyerAddress: buyer,
  amount: "500",
  status: "PENDING",
} as Order;

describe("on-chain order confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.post.mockResolvedValue(order);
    mocks.buildConfirmOrder.mockResolvedValue({
      success: true,
      data: "unsigned-xdr",
    });
    mocks.signAndSubmitTransaction.mockResolvedValue({
      success: true,
      outcome: "confirmed",
      txHash: "confirmed-hash",
    });
    mocks.get.mockResolvedValue(order);
    mocks.patch.mockResolvedValue({ ...order, status: "CONFIRMED" });
  });

  it("sends a required idempotency key when creating an order intent", async () => {
    await createOrder(
      { buyerAddress: buyer, campaignId: "campaign-1", amount: "500" },
      "attempt-key",
    );

    expect(mocks.post).toHaveBeenCalledWith(
      "/orders",
      { buyerAddress: buyer, campaignId: "campaign-1", amount: "500" },
      {
        retries: 0,
        headers: { "X-Idempotency-Key": "attempt-key" },
      },
    );
  });

  it("submits confirm_order for the on-chain ID before updating the API", async () => {
    const result = await confirmOrderReceipt(order, buyer);

    expect(mocks.get).toHaveBeenCalledWith("/orders/db-order-1");
    expect(mocks.buildConfirmOrder).toHaveBeenCalledWith(buyer, "42");
    expect(mocks.signAndSubmitTransaction).toHaveBeenCalledWith(
      "unsigned-xdr",
      undefined,
      { intent: `confirm_order:42:${buyer}` },
    );
    expect(mocks.patch).toHaveBeenCalledWith(
      "/orders/db-order-1/confirm",
      { buyerAddress: buyer, txHash: "confirmed-hash" },
      { retries: 0 },
    );
    expect(result.order.status).toBe("CONFIRMED");
    expect(result.alreadyConfirmed).toBe(false);
  });

  it("leaves database state unchanged when the wallet rejects", async () => {
    mocks.signAndSubmitTransaction.mockResolvedValue({
      success: false,
      outcome: "failed",
      error: "Transaction rejected by wallet",
    });

    await expect(confirmOrderReceipt(order, buyer)).rejects.toThrow(
      "Transaction rejected by wallet",
    );
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("does not mark a submitted but unconfirmed transaction as confirmed", async () => {
    mocks.signAndSubmitTransaction.mockResolvedValue({
      success: false,
      outcome: "pending",
      txHash: "pending-hash",
      error: "Still confirming",
    });

    await expect(confirmOrderReceipt(order, buyer)).rejects.toThrow(
      "Still confirming",
    );
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("treats an already-confirmed order as a no-op", async () => {
    const confirmed = { ...order, status: "CONFIRMED" } as Order;
    mocks.get.mockResolvedValue(confirmed);

    await expect(confirmOrderReceipt(order, buyer)).resolves.toEqual({
      order: confirmed,
      alreadyConfirmed: true,
    });
    expect(mocks.buildConfirmOrder).not.toHaveBeenCalled();
    expect(mocks.signAndSubmitTransaction).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("does not submit an intent placeholder before indexer reconciliation", async () => {
    mocks.get.mockResolvedValue({ ...order, onChainId: "intent:uuid" });
    await expect(
      confirmOrderReceipt(order, buyer),
    ).rejects.toThrow("still being reconciled");
    expect(mocks.buildConfirmOrder).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });
});
