import type { Order } from "@/types";
import api from "../lib/apiClient";

export async function fetchOrdersByBuyer(buyerAddress: string): Promise<Order[]> {
  return api.get<Order[]>(`/orders?buyerAddress=${encodeURIComponent(buyerAddress)}`);
}

export async function fetchOrdersByFarmer(farmerAddress: string): Promise<Order[]> {
  return api.get<Order[]>(`/orders?farmerAddress=${encodeURIComponent(farmerAddress)}`);
}

/**
 * Fetch one order by id through the authenticated API client (#1052).
 *
 * The server scopes this to the session wallet: 401 when unauthenticated,
 * 403 when the order belongs to another wallet, 404 when it does not exist.
 * ApiError/NetworkError propagate so the page can render distinct,
 * non-leaking states. `signal` lets the page abort stale requests (e.g. a
 * navigation or a changed orderId) — the client re-throws external aborts
 * as-is, which the page uses to ignore them.
 */
export async function fetchOrderById(
  orderId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Order> {
  const sanitized = orderId.replace(/[^a-zA-Z0-9-]/g, "");
  return api.get<Order>(`/orders/${encodeURIComponent(sanitized)}`, {
    signal: options.signal,
  });
}

export async function createOrder(
  data: {
    buyerAddress: string;
    campaignId: string;
    amount: string;
  },
  idempotencyKey = globalThis.crypto.randomUUID(),
): Promise<Order> {
  const sanitized = {
    buyerAddress: data.buyerAddress.replace(/[<>]/g, "").trim(),
    campaignId: data.campaignId.replace(/[<>]/g, "").trim(),
    amount: data.amount.replace(/[^0-9]/g, ""),
  };
  // retries: 0 prevents double-submission on a non-idempotent POST
  return api.post<Order>(`/orders`, sanitized, {
    retries: 0,
    headers: { "X-Idempotency-Key": idempotencyKey },
  });
}

export interface OrderConfirmationResult {
  order: Order;
  alreadyConfirmed: boolean;
}

export async function confirmOrderReceipt(
  order: Order,
  buyerAddress: string,
): Promise<OrderConfirmationResult> {
  const currentOrder = await api.get<Order>(
    `/orders/${encodeURIComponent(order.id)}`,
  );
  if (currentOrder.status === "CONFIRMED") {
    return { order: currentOrder, alreadyConfirmed: true };
  }
  if (currentOrder.status !== "PENDING") {
    throw new Error(`Order cannot be confirmed while its status is ${currentOrder.status}.`);
  }
  if (currentOrder.onChainId.startsWith("intent:")) {
    throw new Error("This order is still being reconciled to the chain. Refresh before confirming.");
  }

  const { buildConfirmOrder } = await import("@/lib/contractService");
  const built = await buildConfirmOrder(buyerAddress, currentOrder.onChainId);
  if (!built.success || !built.data) {
    throw new Error(built.error ?? "Could not build the on-chain confirmation transaction.");
  }

  const { signAndSubmitTransaction } = await import("@/lib/signTransaction");
  const submitted = await signAndSubmitTransaction(built.data, undefined, {
    intent: `confirm_order:${currentOrder.onChainId}:${buyerAddress}`,
  });
  if (!submitted.success) {
    throw new Error(
      submitted.outcome === "pending"
        ? submitted.error ?? "Confirmation is pending. Do not retry until the transaction resolves."
        : submitted.error ?? "The on-chain confirmation failed.",
    );
  }

  const sanitized = {
    buyerAddress: buyerAddress.replace(/[<>]/g, "").trim(),
  };
  try {
    const updated = await api.patch<Order>(
      `/orders/${encodeURIComponent(currentOrder.id)}/confirm`,
      { ...sanitized, txHash: submitted.txHash },
      { retries: 0 },
    );
    return { order: updated, alreadyConfirmed: false };
  } catch (error) {
    throw new Error(
      `Receipt was confirmed on-chain${submitted.txHash ? ` (${submitted.txHash})` : ""}, but the API could not update the order. Refresh shortly; do not submit another confirmation.`,
      { cause: error },
    );
  }
}

export async function updateOrderWithTxHash(orderId: string, txHash: string): Promise<Order> {
  const sanitized = {
    txHash: txHash.replace(/[^a-zA-Z0-9]/g, ""),
  };
  return api.put<Order>(`/orders/${orderId}`, sanitized);
}
