"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, Badge, Text, Button } from "@/components/ui";
import { getOrder, type Order } from "@/services/stellar/contractService";

export type EscrowStatus = "pending" | "funded" | "delivered" | "refunded";

export interface TransactionStatusTrackerProps {
  orderId: string;
  initialStatus?: EscrowStatus;
  onStatusChange?: (status: EscrowStatus, order: Order) => void;
  pollInterval?: number;
  className?: string;
}

interface StatusConfig {
  label: string;
  description: string;
  badgeVariant: "default" | "primary" | "secondary" | "success" | "warning" | "error" | "outline";
  color: string;
  icon: React.ReactNode;
}

const statusConfig: Record<EscrowStatus, StatusConfig> = {
  pending: {
    label: "Pending",
    description: "Transaction is waiting for funding",
    badgeVariant: "warning",
    color: "text-yellow-600",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  funded: {
    label: "Funded",
    description: "Escrow has been funded successfully",
    badgeVariant: "primary",
    color: "text-blue-600",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  delivered: {
    label: "Delivered",
    description: "Goods have been delivered and confirmed",
    badgeVariant: "success",
    color: "text-green-600",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  refunded: {
    label: "Refunded",
    description: "Transaction has been refunded",
    badgeVariant: "error",
    color: "text-red-600",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
      </svg>
    ),
  },
};

export function TransactionStatusTracker({
  orderId,
  initialStatus,
  onStatusChange,
  pollInterval = 5000,
  className = "",
}: TransactionStatusTrackerProps) {
  const [status, setStatus] = useState<EscrowStatus>(initialStatus || "pending");
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

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

  const fetchOrderStatus = useCallback(async () => {
    if (!orderId) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await getOrder(orderId);
      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to fetch order status");
      }

      const orderData = result.data;
      const newStatus = mapOrderStatusToEscrowStatus(orderData.status);
      
      setOrder(orderData);
      setLastUpdated(new Date());

      if (newStatus !== status) {
        setStatus(newStatus);
        onStatusChange?.(newStatus, orderData);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      console.error("Error fetching order status:", err);
    } finally {
      setIsLoading(false);
    }
  }, [orderId, status, onStatusChange]);

  useEffect(() => {
    fetchOrderStatus();

    const interval = setInterval(fetchOrderStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchOrderStatus, pollInterval]);

  const currentConfig = statusConfig[status];

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatLastUpdated = (date: Date) => {
    return date.toLocaleTimeString();
  };

  return (
    <Card variant="elevated" padding="lg" className={className}>
      <CardContent className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Text variant="h4" as="h4">
            Transaction Status
          </Text>
          <Badge variant={currentConfig.badgeVariant} className="flex items-center gap-2">
            {currentConfig.icon}
            {currentConfig.label}
          </Badge>
        </div>

        {/* Status Description */}
        <div className={`${currentConfig.color}`}>
          <Text variant="body" className="flex items-center gap-2">
            {currentConfig.icon}
            {currentConfig.description}
          </Text>
        </div>

        {/* Order Details */}
        {order && (
          <div className="bg-muted/50 p-4 rounded-lg space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Text variant="caption" muted className="block mb-1">
                  Order ID
                </Text>
                <Text variant="bodySmall" className="font-mono">
                  {order.orderId}
                </Text>
              </div>
              <div>
                <Text variant="caption" muted className="block mb-1">
                  Amount
                </Text>
                <Text variant="bodySmall" className="font-medium">
                  {(Number(order.amount) / 10_000_000).toFixed(2)} XLM
                </Text>
              </div>
              <div>
                <Text variant="caption" muted className="block mb-1">
                  Buyer
                </Text>
                <Text variant="bodySmall" className="font-mono text-xs">
                  {order.buyer.slice(0, 8)}...{order.buyer.slice(-8)}
                </Text>
              </div>
              <div>
                <Text variant="caption" muted className="block mb-1">
                  Seller
                </Text>
                <Text variant="bodySmall" className="font-mono text-xs">
                  {order.seller.slice(0, 8)}...{order.seller.slice(-8)}
                </Text>
              </div>
            </div>
            
            <div>
              <Text variant="caption" muted className="block mb-1">
                Created
              </Text>
              <Text variant="bodySmall">
                {formatTimestamp(order.createdAt)}
              </Text>
            </div>
          </div>
        )}

        {/* Status Timeline */}
        <div className="space-y-2">
          <Text variant="h3" as="h3">
            Status Timeline
          </Text>
          <div className="flex items-center gap-2">
            {Object.entries(statusConfig).map(([key, config]) => {
              const isActive = status === key;
              const isPast = Object.keys(statusConfig).indexOf(key) < Object.keys(statusConfig).indexOf(status);
              
              return (
                <div key={key} className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : isPast
                        ? "bg-muted text-muted-foreground"
                        : "bg-muted/30 text-muted/50"
                    }`}
                  >
                    {config.icon}
                  </div>
                  <div
                    className={`h-1 w-12 ${
                      isActive || isPast ? "bg-primary" : "bg-muted/30"
                    }`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            {Object.values(statusConfig).map((config, index) => (
              <div key={index} className="text-center">
                {config.label}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-2">
            {isLoading && (
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            )}
            <Text variant="caption" muted>
              Last updated: {formatLastUpdated(lastUpdated)}
            </Text>
          </div>
          <Button variant="outline" size="sm" onClick={fetchOrderStatus} disabled={isLoading}>
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-error/10 border border-error/20 p-3 rounded-lg">
            <Text variant="bodySmall">
              Error: {error}
            </Text>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TransactionStatusTracker;
