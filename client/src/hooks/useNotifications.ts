"use client";

/**
 * useNotifications
 *
 * Manages the notification list for the connected wallet:
 *   - Fetches paginated history from the API (read + unread)
 *   - Provides mark-as-read, delete, and clear-all actions with rollback
 *   - Exposes an unread badge count
 *   - Accepts a filter by notification type and a search term
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  listNotifications,
  deleteNotificationById,
  clearAllNotifications,
  markNotificationsRead,
} from "@/services/notification/api";
import type { OrderEventNotification } from "@/services/notification/api";

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
  deleteNotification: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  refetch: () => Promise<void>;
}

// Map backend event types to UI category filters
// Backend types: order_created, funds_locked, delivery_confirmed, refund_issued,
// order_received, new_investment, campaign_funded, group_order_*, weather_alert, etc.
// Plus legacy short types like "created"/"confirmed"
const ORDERS_KEYWORDS = [
  "order",
  "funds_locked",
  "delivery_confirmed",
  "refund",
  "created",
  "confirmed",
  "investment",
  "campaign",
  "group_order",
];

const DISPUTES_KEYWORDS = ["dispute"];

const SYSTEM_KEYWORDS = ["weather", "system", "harvest_completed", "alert"];

function matchesFilter(type: string, filter: NotificationFilter): boolean {
  if (filter === "all") return true;
  const lower = type.toLowerCase();
  if (filter === "orders") {
    return ORDERS_KEYWORDS.some((k) => lower.includes(k));
  }
  if (filter === "disputes") {
    return DISPUTES_KEYWORDS.some((k) => lower.includes(k));
  }
  if (filter === "system") {
    // System is weather/system alerts that are not orders/disputes
    const isSystem = SYSTEM_KEYWORDS.some((k) => lower.includes(k));
    const isOrder = ORDERS_KEYWORDS.some((k) => lower.includes(k));
    const isDispute = DISPUTES_KEYWORDS.some((k) => lower.includes(k));
    if (lower === "system" || lower === "weather_alert") return true;
    return isSystem && !isOrder && !isDispute;
  }
  return false;
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
  const isLoadingRef = useRef(false);

  // Sync ref with state for guard checks
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const loadNotifications = useCallback(
    async (p = 1) => {
      if (!walletAddress) return;
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      setIsLoading(true);
      setError(null);
      try {
        // Explicitly request full history (read + unread); pagination contract is page/page_size + total
        const data = await listNotifications(walletAddress, {
          unreadOnly: false,
          page: p,
          pageSize,
        });

        // Prevent duplicates when paging or when real-time inserts overlap HTTP
        setAll((prev) => {
          if (p === 1) return data.items;
          const existingIds = new Set(prev.map((n) => n.id));
          const unique = data.items.filter((n) => !existingIds.has(n.id));
          return [...prev, ...unique];
        });

        // Contract validation: listNotifications already throws if total is not a finite number,
        // so we cannot silently set total to undefined
        setTotal(data.total);
        setPage(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        isLoadingRef.current = false;
        setIsLoading(false);
      }
    },
    [walletAddress, pageSize],
  );

  useEffect(() => {
    void loadNotifications(1);
  }, [loadNotifications]);

  // Client-side filter + search with event-type to category mapping
  const filtered = all.filter((n) => {
    if (!matchesFilter(n.type, filter)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!n.message.toLowerCase().includes(q) && !n.type.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const unreadCount = all.filter((n) => !n.isRead).length;
  const hasNextPage = all.length < total;

  const loadNextPage = useCallback(async () => {
    if (!hasNextPage || isLoadingRef.current) return;
    await loadNotifications(page + 1);
  }, [hasNextPage, loadNotifications, page]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!walletAddress || ids.length === 0) return;
      try {
        await markNotificationsRead(walletAddress, ids);
        setAll((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, isRead: true } : n)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to mark as read");
        throw e;
      }
    },
    [walletAddress],
  );

  const markAllRead = useCallback(async () => {
    const unread = all.filter((n) => !n.isRead).map((n) => n.id);
    await markRead(unread);
  }, [all, markRead]);

  const deleteNotification = useCallback(
    async (id: string) => {
      if (!walletAddress) return;
      const prevAll = all;
      const prevTotal = total;
      // Optimistic update
      setAll((prev) => prev.filter((n) => n.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setError(null);
      try {
        await deleteNotificationById(walletAddress, id);
      } catch (e) {
        // Rollback on failure; keep item visible with actionable error
        setAll(prevAll);
        setTotal(prevTotal);
        const message = e instanceof Error ? e.message : "Failed to delete notification";
        setError(message);
        throw e;
      }
    },
    [walletAddress, all, total],
  );

  const clearAll = useCallback(async () => {
    if (!walletAddress) return;
    if (all.length === 0 && total === 0) return;
    const prevAll = all;
    const prevTotal = total;
    // Optimistic: clear visible page; real scope is all notifications for wallet on server
    setAll([]);
    setTotal(0);
    setError(null);
    try {
      await clearAllNotifications(walletAddress);
      // Ensure total reflects server state; refetch first page could be done but we already cleared
    } catch (e) {
      // Rollback – refresh does not resurrect falsely deleted items because we restore prev state
      setAll(prevAll);
      setTotal(prevTotal);
      const message = e instanceof Error ? e.message : "Failed to clear notifications";
      setError(message);
      throw e;
    }
  }, [walletAddress, all, total]);

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
