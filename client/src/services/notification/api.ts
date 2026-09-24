import { apiRequest } from "@/lib/apiHelper";

export interface OrderEventNotification {
  id: string;
  walletAddress: string;
  message: string;
  orderId: string | null;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export async function listUnreadNotifications(
  walletAddress: string,
): Promise<OrderEventNotification[]> {
  void walletAddress;
  const response = await apiRequest<{ items: OrderEventNotification[] }>(
    "/notifications?unread_only=true",
    {
      method: "GET",
      cache: "no-store",
    },
  );

  return response.items;
}

export async function markNotificationsRead(
  _walletAddress: string,
  ids: string[],
): Promise<{ count: number }> {
  return apiRequest<{ count: number }>("/notifications/read", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: { ids },
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
  void walletAddress;
  const response = await apiRequest<{ preferences: NotificationPrefs }>(
    "/notifications/preferences",
    {
      method: "GET",
      headers: {},
      cache: "no-store",
    },
  );
  return { ...DEFAULT_NOTIFICATION_PREFS, ...response.preferences };
}

export async function updateNotificationPreferences(
  _walletAddress: string,
  preferences: NotificationPrefs,
): Promise<NotificationPrefs> {
  const response = await apiRequest<{ preferences: NotificationPrefs }>(
    "/notifications/preferences",
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: preferences,
    },
  );
  return response.preferences;
}
