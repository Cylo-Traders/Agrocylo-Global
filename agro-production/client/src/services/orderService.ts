import type { Order } from "@/types";
import api from "../lib/apiClient";

export async function fetchOrdersByBuyer(buyerAddress: string): Promise<Order[]> {
  return api.get<Order[]>(`/orders?buyerAddress=${encodeURIComponent(buyerAddress)}`);
}

export async function fetchOrdersByFarmer(farmerAddress: string): Promise<Order[]> {
  return api.get<Order[]>(`/orders?farmerAddress=${encodeURIComponent(farmerAddress)}`);
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
export async function updateOrderWithTxHash(orderId: string, txHash: string): Promise<Order> {
  const sanitized = {
    txHash: txHash.replace(/[^a-zA-Z0-9]/g, ""),
  };
  return api.put<Order>(`/orders/${orderId}`, sanitized);
}
