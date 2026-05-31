"use client";

/**
 * useNotifications
 *
 * Manages the notification list for the connected wallet:
 *   - Fetches paginated history from the API
 *   - Provides mark-as-read, delete, and clear-all actions
 *   - Exposes an unread badge count
 *   - Accepts a filter by notification type and a search term
 */

import { useState, useEffect, useCallback } from "react";
import { markNotificationsRead } from "@/services/notification/api";
import type { OrderEventNotification } from "@/services/notification/api";
import { API_BASE_URL } from "@/lib/apiConfig";

export type NotificationFilter = "all" | "orders" | "disputes" | "system";

interface UseNotificationsOptions {
  walletAddress: string | null;
  filter?: NotificationFilter;
  search?: string;
  pageSize?: number;
}

interface UseNotificationsResult {
  notifications: OrderEventNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  hasNextPage: boolean;
  loadNextPage: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteNotification: (id: string) => void;
  clearAll: () => void;
  refetch: () => Promise<void>;
}

async function fetchAllNotifications(
  walletAddress: string,
  page: number,
  pageSize: number,
): Promise<{ items: OrderEventNotification[]; total: number }> {
  const url = new URL(`${API_BASE_URL}/notifications`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));

  const res = await fetch(url, {
    headers: { "x-wallet-address": walletAddress },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch notifications: ${res.status}`);
  return res.json() as Promise<{ items: OrderEventNotification[]; total: number }>;
}

async function deleteNotificationById(walletAddress: string, id: string): Promise<void> {
  await fetch(`${API_BASE_URL}/notifications/${id}`, {
    method: "DELETE",
    headers: { "x-wallet-address": walletAddress },
  });
}

export function useNotifications({
  walletAddress,
  filter = "all",
  search = "",
  pageSize = 20,
}: UseNotificationsOptions): UseNotificationsResult {
  const [all, setAll] = useState<OrderEventNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(
    async (p = 1) => {
      if (!walletAddress) return;
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchAllNotifications(walletAddress, p, pageSize);
        setAll((prev) => (p === 1 ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
        setPage(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [walletAddress, pageSize],
  );

  useEffect(() => {
    void loadNotifications(1);
  }, [loadNotifications]);

  // Client-side filter + search
  const filtered = all.filter((n) => {
    if (filter !== "all" && n.type !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!n.message.toLowerCase().includes(q) && !n.type.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const unreadCount = all.filter((n) => !n.isRead).length;
  const hasNextPage = all.length < total;

  const loadNextPage = useCallback(() => loadNotifications(page + 1), [loadNotifications, page]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!walletAddress || ids.length === 0) return;
      await markNotificationsRead(walletAddress, ids);
      setAll((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, isRead: true } : n)));
    },
    [walletAddress],
  );

  const markAllRead = useCallback(async () => {
    const unread = all.filter((n) => !n.isRead).map((n) => n.id);
    await markRead(unread);
  }, [all, markRead]);

  const deleteNotification = useCallback(
    (id: string) => {
      setAll((prev) => prev.filter((n) => n.id !== id));
      setTotal((t) => t - 1);
      if (walletAddress) void deleteNotificationById(walletAddress, id);
    },
    [walletAddress],
  );

  const clearAll = useCallback(() => {
    all.forEach((n) => {
      if (walletAddress) void deleteNotificationById(walletAddress, n.id);
    });
    setAll([]);
    setTotal(0);
  }, [all, walletAddress]);

  return {
    notifications: filtered,
    unreadCount,
    isLoading,
    error,
    hasNextPage,
    loadNextPage,
    markRead,
    markAllRead,
    deleteNotification,
    clearAll,
    refetch: () => loadNotifications(1),
  };
}
