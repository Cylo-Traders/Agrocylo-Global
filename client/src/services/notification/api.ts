import { API_BASE_URL } from "@/lib/apiConfig";
import { getAccessToken } from "@/lib/authToken";

export interface OrderEventNotification {
  id: string;
  walletAddress: string;
  message: string;
  orderId: string | null;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export interface ListNotificationsParams {
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
  limit?: number;
}

export interface ListNotificationsResult {
  items: OrderEventNotification[];
  total: number;
}

function authHeaders(walletAddress: string): Record<string, string> {
  const token = typeof window !== "undefined" ? getAccessToken() : null;
  const headers: Record<string, string> = {
    "x-wallet-address": walletAddress,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
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

export async function listNotifications(
  walletAddress: string,
  params: ListNotificationsParams = {},
): Promise<ListNotificationsResult> {
  const url = new URL(`${API_BASE_URL}/notifications`);
  if (params.unreadOnly !== undefined) {
    url.searchParams.set("unread_only", String(params.unreadOnly));
  }
  if (params.page !== undefined) {
    url.searchParams.set("page", String(params.page));
  }
  if (params.pageSize !== undefined) {
    url.searchParams.set("page_size", String(params.pageSize));
  }
  if (params.limit !== undefined) {
    url.searchParams.set("limit", String(params.limit));
  }

  const response = await requestJson<{ items: OrderEventNotification[]; total: number }>(url, {
    method: "GET",
    headers: authHeaders(walletAddress),
    cache: "no-store",
  });

  // Contract validation: total must be a number, cannot silently be undefined
  if (typeof response.total !== "number" || !Number.isFinite(response.total)) {
    throw new Error("Invalid notification list response: missing total");
  }
  if (!Array.isArray(response.items)) {
    throw new Error("Invalid notification list response: missing items");
  }

  return response;
}

export async function listUnreadNotifications(
  walletAddress: string,
): Promise<OrderEventNotification[]> {
  const result = await listNotifications(walletAddress, { unreadOnly: true });
  return result.items;
}

export async function markNotificationsRead(
  walletAddress: string,
  ids: string[],
): Promise<{ count: number }> {
  return requestJson<{ count: number }>(`${API_BASE_URL}/notifications/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(walletAddress),
    },
    body: JSON.stringify({ ids }),
  });
}

export async function deleteNotificationById(
  walletAddress: string,
  id: string,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/notifications/${id}`, {
    method: "DELETE",
    headers: authHeaders(walletAddress),
  });
  if (!res.ok) {
    let message = `Failed to delete notification ${id}: ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message || body?.title || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
}

export async function clearAllNotifications(
  walletAddress: string,
): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE_URL}/notifications`, {
    method: "DELETE",
    headers: authHeaders(walletAddress),
  });
  if (!res.ok) {
    let message = `Failed to clear notifications: ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message || body?.title || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as { count: number };
}

export interface NotificationPrefs {
  types: {
    orders: boolean;
    disputes: boolean;
    priceAlerts: boolean;
    system: boolean;
    demandSignals: boolean;
  };
  delivery: {
    toast: boolean;
    email: boolean;
    push: boolean;
  };
  sound: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  types: {
    orders: true,
    disputes: true,
    priceAlerts: true,
    system: true,
    demandSignals: false,
  },
  delivery: {
    toast: true,
    email: false,
    push: false,
  },
  sound: true,
  quietHoursEnabled: false,
  quietStart: "22:00",
  quietEnd: "08:00",
};

export async function getNotificationPreferences(
  walletAddress: string,
): Promise<NotificationPrefs> {
  const response = await requestJson<{ preferences: NotificationPrefs }>(
    `${API_BASE_URL}/notifications/preferences`,
    {
      method: "GET",
      headers: authHeaders(walletAddress),
      cache: "no-store",
    },
  );
  return { ...DEFAULT_NOTIFICATION_PREFS, ...response.preferences };
}

export async function updateNotificationPreferences(
  walletAddress: string,
  preferences: NotificationPrefs,
): Promise<NotificationPrefs> {
  const response = await requestJson<{ preferences: NotificationPrefs }>(
    `${API_BASE_URL}/notifications/preferences`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(walletAddress),
      },
      body: JSON.stringify(preferences),
    },
  );
  return response.preferences;
}
