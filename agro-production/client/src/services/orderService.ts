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

export async function createOrder(data: {
  buyerAddress: string;
  campaignId: string;
  amount: string;
}): Promise<Order> {
  const sanitized = {
    buyerAddress: data.buyerAddress.replace(/[<>]/g, "").trim(),
    campaignId: data.campaignId.replace(/[<>]/g, "").trim(),
    amount: data.amount.replace(/[^0-9]/g, ""),
  };
  // retries: 0 prevents double-submission on a non-idempotent POST
  return api.post<Order>(`/orders`, sanitized, { retries: 0 });
}

export async function confirmOrderReceipt(orderId: string, buyerAddress: string): Promise<Order> {
  // Note: This is a client-side acknowledgement only. The API call does not release on-chain escrow funds.
  // On-chain confirmation via the smart contract is the authoritative release mechanism.
  const sanitized = {
    buyerAddress: buyerAddress.replace(/[<>]/g, "").trim(),
  };
  return api.patch<Order>(`/orders/${orderId}/confirm`, sanitized, { retries: 0 });
}

export async function updateOrderWithTxHash(orderId: string, txHash: string): Promise<Order> {
  const sanitized = {
    txHash: txHash.replace(/[^a-zA-Z0-9]/g, ""),
  };
  return api.put<Order>(`/orders/${orderId}`, sanitized);
}
