"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getOrder, type Order } from "@/services/stellar/contractService";
import { useSocket } from "@/hooks/useSocket";
import type { EscrowStatus } from "@/components/TransactionStatusTracker";

interface UseTransactionStatusTrackerOptions {
  orderId: string;
  initialStatus?: EscrowStatus;
  pollInterval?: number;
  autoStart?: boolean;
}

interface TransactionStatusState {
  status: EscrowStatus;
  order: Order | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date;
  confirmationCount: number;
}

/** Poll less aggressively once an order reaches a terminal state. */
const ADAPTIVE_INTERVALS: Record<EscrowStatus, number> = {
  pending: 5_000,
  funded: 8_000,
  delivered: 15_000,
  refunded: 30_000,
  disputed: 20_000,
};

export function mapOrderStatusToEscrowStatus(orderStatus: string): EscrowStatus {
  switch (orderStatus.toLowerCase()) {
    case "created":
    case "pending":
      return "pending";
    case "funded":
    case "active":
      return "funded";
    case "delivered":
    case "completed":
      return "delivered";
    case "refunded":
    case "cancelled":
      return "refunded";
    case "disputed":
    case "dispute":
      return "disputed";
    default:
      return "pending";
  }
}

export function useTransactionStatusTracker({
  orderId,
  initialStatus = "pending",
  pollInterval,
  autoStart = true,
}: UseTransactionStatusTrackerOptions) {
  const [state, setState] = useState<TransactionStatusState>({
    status: initialStatus,
    order: null,
    isLoading: false,
    error: null,
    lastUpdated: new Date(),
    confirmationCount: 0,
  });

  const [isPolling, setIsPolling] = useState(autoStart);
  const wsUnavailable = useRef(false);
  const { isConnected, on } = useSocket();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!orderId) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await getOrder(orderId);
      if (!result.success || !result.data) {
        throw new Error(result.error ?? "Failed to fetch order status");
      }

      const orderData = result.data;
      const newStatus = mapOrderStatusToEscrowStatus(orderData.status);

      setState((prev) => ({
        ...prev,
        status: newStatus,
        order: orderData,
        isLoading: false,
        lastUpdated: new Date(),
        confirmationCount: prev.confirmationCount + (newStatus !== prev.status ? 1 : 0),
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setState((prev) => ({ ...prev, isLoading: false, error: errorMessage }));
    }
  }, [orderId]);

  // Subscribe to real-time WebSocket events when the socket is live
  useEffect(() => {
    if (!isConnected) {
      wsUnavailable.current = true;
      return;
    }
    wsUnavailable.current = false;

    const unsub = on(`order:${orderId}`, (payload) => {
      const data = payload as { status?: string; order?: Order };
      if (!data.status) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        const newStatus = mapOrderStatusToEscrowStatus(data.status!);
        setState((prev) => {
          if (newStatus !== prev.status) {
            import("sonner").then(({ toast }) => {
              toast.success(`Order Status Updated!`, {
                description: `Order #${orderId} status changed from ${prev.status} to ${newStatus}`,
                duration: 5000,
              });
            });
          }
          return {
            ...prev,
            status: newStatus,
            order: data.order ?? prev.order,
            lastUpdated: new Date(),
            confirmationCount: prev.confirmationCount + 1,
          };
        });
      }, 150);
    });

    return () => {
      unsub();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [isConnected, orderId, on]);

  // Adaptive polling — only active when WebSocket is unavailable
  useEffect(() => {
    if (!isPolling) return;
    if (isConnected && !wsUnavailable.current) return;

    void fetchStatus();

    const interval = pollInterval ?? ADAPTIVE_INTERVALS[state.status];
    const timer = setInterval(() => void fetchStatus(), interval);
    return () => clearInterval(timer);
  }, [isPolling, isConnected, fetchStatus, state.status, pollInterval]);

  const startPolling = useCallback(() => setIsPolling(true), []);
  const stopPolling = useCallback(() => setIsPolling(false), []);
  const refresh = useCallback(() => void fetchStatus(), [fetchStatus]);

  return {
    ...state,
    isPolling,
    startPolling,
    stopPolling,
    refresh,
  };
}

