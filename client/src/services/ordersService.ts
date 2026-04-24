const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000";

export type BuyerOrderStatus = "PENDING" | "COMPLETED" | "REFUNDED";
export type BuyerOrderFilter = "all" | "active" | "completed" | "refunded";

export interface BuyerOrder {
  id: string;
  order_id: string;
  buyer_address: string;
  seller_address: string;
  seller_name: string | null;
  amount: string;
  token: string;
  status: BuyerOrderStatus;
  created_at: string;
  updated_at: string;
  product: {
    id: string;
    name: string;
    unit: string | null;
    image_url: string | null;
  } | null;
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message || body?.detail || body?.title || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function listBuyerOrders(
  walletAddress: string,
  status: BuyerOrderFilter = "all",
): Promise<{ items: BuyerOrder[] }> {
  const url = new URL(`${API_BASE_URL}/orders`);
  if (status !== "all") {
    url.searchParams.set("status", status);
  }

  return requestJson<{ items: BuyerOrder[] }>(url, {
    headers: {
      "x-wallet-address": walletAddress,
    },
    cache: "no-store",
  });
}
