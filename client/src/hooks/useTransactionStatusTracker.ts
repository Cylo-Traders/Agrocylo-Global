"use client";

import { useState, useEffect, useCallback } from "react";
import { getOrder, type Order } from "@/services/stellar/contractService";
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
}

export function useTransactionStatusTracker({
  orderId,
  initialStatus = "pending",
  pollInterval = 5000,
  autoStart = true,
}: UseTransactionStatusTrackerOptions) {
  const [state, setState] = useState<TransactionStatusState>({
    status: initialStatus,
    order: null,
    isLoading: false,
    error: null,
    lastUpdated: new Date(),
  });

  const [isPolling, setIsPolling] = useState(autoStart);

  const mapOrderStatusToEscrowStatus = (orderStatus: string): EscrowStatus => {
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
      default:
        return "pending";
    }
  };

  const fetchStatus = useCallback(async () => {
    if (!orderId) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await getOrder(orderId);
      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to fetch order status");
      }

      const orderData = result.data;
      const newStatus = mapOrderStatusToEscrowStatus(orderData.status);

      setState(prev => ({
        ...prev,
        status: newStatus,
        order: orderData,
        isLoading: false,
        lastUpdated: new Date(),
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
    }
  }, [orderId]);

  const startPolling = useCallback(() => {
    if (isPolling) return;
    setIsPolling(true);
  }, [isPolling]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
  }, []);

  const refresh = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!isPolling) return;

    fetchStatus();

    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [isPolling, fetchStatus, pollInterval]);

  return {
    ...state,
    isPolling,
    startPolling,
    stopPolling,
    refresh,
  };
}
