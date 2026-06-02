import { API_BASE_URL } from "@/lib/apiConfig";

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
      headers: {
        "x-wallet-address": walletAddress,
      },
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
        "x-wallet-address": walletAddress,
      },
      body: JSON.stringify(preferences),
    },
  );
  return response.preferences;
}
