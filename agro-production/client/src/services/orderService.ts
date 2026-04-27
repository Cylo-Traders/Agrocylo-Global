import type { Order } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export async function fetchOrdersByBuyer(buyerAddress: string): Promise<Order[]> {
  const res = await fetch(
    `${API_BASE}/orders?buyerAddress=${encodeURIComponent(buyerAddress)}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch buyer orders: ${res.status}`);
  return res.json();
}

export async function fetchOrdersByFarmer(farmerAddress: string): Promise<Order[]> {
  const res = await fetch(
    `${API_BASE}/orders?farmerAddress=${encodeURIComponent(farmerAddress)}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch farmer orders: ${res.status}`);
  return res.json();
}

export async function createOrder(data: {
  buyerAddress: string;
  campaignId: string;
  amount: string;
}): Promise<Order> {
  const res = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Failed to create order: ${res.status}`);
  }
  return res.json();
}
