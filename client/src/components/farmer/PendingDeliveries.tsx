"use client";

import React from "react";
import { Card, CardContent, Text, Button, Badge } from "@/components/ui";
import { type Order } from "@/services/stellar/contractService";
import { useEscrowContract } from "@/hooks/useEscrowContract";

interface PendingDeliveriesProps {
  orders: Order[];
  isLoading?: boolean;
  onOrderUpdate?: () => void;
}

export default function PendingDeliveries({
  orders,
  isLoading = false,
  onOrderUpdate,
}: PendingDeliveriesProps) {
  const { confirmReceipt, confirmState } = useEscrowContract();

  const handleConfirmDelivery = async (orderId: string) => {
    try {
      await confirmReceipt(orderId);
      onOrderUpdate?.();
    } catch (error) {
      console.error("Failed to confirm delivery:", error);
    }
  };

  const formatAmount = (stroops: bigint): string => {
    return (Number(stroops) / 1e7).toFixed(2);
  };

  const truncateAddress = (addr: string): string => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "pending":
        return "warning";
      case "funded":
        return "primary";
      default:
        return "default";
    }
  };

  if (isLoading) {
    return (
      <Card variant="elevated" padding="lg">
        <CardContent className="text-center py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/4 mx-auto" />
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted rounded" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (orders.length === 0) {
    return (
      <Card variant="elevated" padding="lg">
        <CardContent className="text-center py-8">
          <Text variant="h4" as="h4" className="mb-2 text-muted">
            No Pending Deliveries
          </Text>
          <Text variant="body" muted>
            You don&apos;t have any orders waiting for delivery confirmation.
          </Text>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {orders.map((order) => (
        <Card key={order.orderId} variant="elevated" padding="lg">
          <CardContent className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <Text variant="h4" as="h4">
                  Order {order.orderId}
                </Text>
                <div className="flex items-center gap-2">
                  <Badge variant={getStatusColor(order.status)}>
                    {order.status}
                  </Badge>
                  <Text variant="caption" muted>
                    Created: {new Date(order.createdAt * 1000).toLocaleDateString()}
                  </Text>
                </div>
              </div>
              <div className="text-right">
                <Text variant="h3" as="h3" className="text-primary">
                  {formatAmount(order.amount)} XLM
                </Text>
                <Text variant="caption" muted>
                  Total amount
                </Text>
              </div>
            </div>

            {/* Order Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/30 p-4 rounded-lg">
              <div>
                <Text variant="caption" muted className="block mb-1">
                  Buyer
                </Text>
                <Text variant="bodySmall" className="font-mono">
                  {truncateAddress(order.buyer)}
                </Text>
              </div>
              <div>
                <Text variant="caption" muted className="block mb-1">
                  You (Seller)
                </Text>
                <Text variant="bodySmall" className="font-mono">
                  {truncateAddress(order.seller)}
                </Text>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <Text variant="bodySmall" muted>
                  Ready for delivery confirmation
                </Text>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleConfirmDelivery(order.orderId)}
                disabled={confirmState.isLoading}
                className="min-w-32"
              >
                {confirmState.isLoading ? "Processing..." : "Confirm Delivery"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
