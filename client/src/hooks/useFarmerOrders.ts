"use client";

import { useState, useEffect, useCallback } from "react";
import { getOrder, type Order } from "@/services/stellar/contractService";

interface UseFarmerOrdersOptions {
  sellerAddress: string;
  pollInterval?: number;
  autoStart?: boolean;
}

interface FarmerOrdersState {
  orders: Order[];
  pendingDeliveries: Order[];
  completedOrders: Order[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date;
}

export function useFarmerOrders({
  sellerAddress,
  pollInterval = 10000,
  autoStart = true,
}: UseFarmerOrdersOptions) {
  const [state, setState] = useState<FarmerOrdersState>({
    orders: [],
    pendingDeliveries: [],
    completedOrders: [],
    isLoading: false,
    error: null,
    lastUpdated: new Date(),
  });

  const [isPolling, setIsPolling] = useState(autoStart);
  const [orderIds, setOrderIds] = useState<string[]>([]);

  const categorizeOrder = (order: Order) => {
    const status = order.status.toLowerCase();
    if (status === "pending" || status === "funded") {
      return { category: "pending", order };
    } else if (status === "delivered" || status === "completed") {
      return { category: "completed", order };
    }
    return { category: "other", order };
  };
  
  const fetchOrders = useCallback(async () => {
    // Mock order IDs for demonstration - in production, this would come from your backend
    const mockOrderIds = [
      "order-001",
      "order-002", 
      "order-003",
      "order-004",
      "order-005"
    ];

    if (!sellerAddress) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // In production, you would fetch order IDs from your backend API
      // For now, we'll use mock order IDs
      const orderIdsToFetch = orderIds.length > 0 ? orderIds : mockOrderIds;
      
      const orderPromises = orderIdsToFetch.map(async (orderId) => {
        try {
          const result = await getOrder(orderId);
          if (result.success && result.data) {
            // Filter by seller address
            if (result.data.seller.toLowerCase() === sellerAddress.toLowerCase()) {
              return result.data;
            }
          }
          return null;
        } catch (error) {
          console.error(`Failed to fetch order ${orderId}:`, error);
          return null;
        }
      });

      const fetchedOrders = (await Promise.all(orderPromises)).filter(
        (order): order is Order => order !== null
      );

      const categorized = fetchedOrders.map(categorizeOrder);
      const pendingDeliveries = categorized
        .filter(item => item.category === "pending")
        .map(item => item.order);
      const completedOrders = categorized
        .filter(item => item.category === "completed")
        .map(item => item.order);

      setState(prev => ({
        ...prev,
        orders: fetchedOrders,
        pendingDeliveries,
        completedOrders,
        isLoading: false,
        lastUpdated: new Date(),
      }));

      // Update order IDs for next poll
      if (orderIds.length === 0) {
        setOrderIds(mockOrderIds);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
    }
  }, [sellerAddress, orderIds]);

  const calculateRevenue = useCallback(() => {
    const completedRevenue = state.completedOrders.reduce(
      (total, order) => total + Number(order.amount) / 10_000_000,
      0
    );
    const pendingRevenue = state.pendingDeliveries.reduce(
      (total, order) => total + Number(order.amount) / 10_000_000,
      0
    );

    return {
      totalRevenue: completedRevenue,
      pendingRevenue,
      completedOrders: state.completedOrders.length,
      pendingDeliveries: state.pendingDeliveries.length,
    };
  }, [state.completedOrders, state.pendingDeliveries]);

  const startPolling = useCallback(() => {
    if (isPolling) return;
    setIsPolling(true);
  }, [isPolling]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
  }, []);

  const refresh = useCallback(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (!isPolling) return;

    // Use setTimeout instead of setInterval to avoid cascading renders
    const timeout = setTimeout(() => {
      fetchOrders();
    }, pollInterval);

    return () => clearTimeout(timeout);
  }, [isPolling, fetchOrders, pollInterval]);

  return {
    ...state,
    revenue: calculateRevenue(),
    isPolling,
    startPolling,
    stopPolling,
    refresh,
  };
}
