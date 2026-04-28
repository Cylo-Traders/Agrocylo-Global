const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000";

export interface OrderEventNotification {
  id: string;
  walletAddress: string;
  message: string;
  orderId: string | null;
  type: string;
  isRead: boolean;
  createdAt: string;
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
      message = body?.message || body?.title || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function listUnreadNotifications(
  walletAddress: string,
): Promise<OrderEventNotification[]> {
  const url = new URL(`${API_BASE_URL}/notifications`);
  url.searchParams.set("unread_only", "true");

  const response = await requestJson<{ items: OrderEventNotification[] }>(url, {
    method: "GET",
    headers: {
      "x-wallet-address": walletAddress,
    },
    cache: "no-store",
  });

  return response.items;
}

export async function markNotificationsRead(
  walletAddress: string,
  ids: string[],
): Promise<{ count: number }> {
  return requestJson<{ count: number }>(`${API_BASE_URL}/notifications/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify({ ids }),
  });
}
