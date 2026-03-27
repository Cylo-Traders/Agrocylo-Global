"use client";

import React from "react";
import { Card, CardContent, Text, Badge } from "@/components/ui";
import { type Order } from "@/services/stellar/contractService";

interface CompletedOrdersProps {
  orders: Order[];
  isLoading?: boolean;
}

export default function CompletedOrders({
  orders,
  isLoading = false,
}: CompletedOrdersProps) {
  const formatAmount = (stroops: bigint): string => {
    return (Number(stroops) / 1e7).toFixed(2);
  };

  const truncateAddress = (addr: string): string => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const calculateEarnings = (order: Order): string => {
    const total = Number(order.amount) / 1e7;
    const fee = total * 0.03; // 3% fee
    const earnings = total - fee;
    return earnings.toFixed(2);
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
            No Completed Orders
          </Text>
          <Text variant="body" muted>
            You don&apos;t have any completed orders yet.
          </Text>
        </CardContent>
      </Card>
    );
  }

  const totalEarnings = orders.reduce(
    (total, order) => total + parseFloat(calculateEarnings(order)),
    0
  );

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card variant="elevated" padding="lg" className="bg-green-50 border-green-200">
        <CardContent className="text-center">
          <Text variant="h2" as="h2" className="text-green-700">
            {totalEarnings.toFixed(2)} XLM
          </Text>
          <Text variant="body" className="text-green-600">
            Total earnings from {orders.length} completed order{orders.length !== 1 ? "s" : ""}
          </Text>
        </CardContent>
      </Card>

      {/* Orders List */}
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
                  <Badge variant="success">
                    Delivered
                  </Badge>
                  <Text variant="caption" muted>
                    Completed: {new Date(order.createdAt * 1000).toLocaleDateString()}
                  </Text>
                </div>
              </div>
              <div className="text-right space-y-1">
                <Text variant="h3" as="h3" className="text-green-600">
                  {calculateEarnings(order)} XLM
                </Text>
                <Text variant="caption" muted>
                  Your earnings
                </Text>
              </div>
            </div>

            {/* Order Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/30 p-4 rounded-lg">
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
                  Total Amount
                </Text>
                <Text variant="bodySmall" className="font-medium">
                  {formatAmount(order.amount)} XLM
                </Text>
              </div>
              <div>
                <Text variant="caption" muted className="block mb-1">
                  Platform Fee (3%)
                </Text>
                <Text variant="bodySmall" className="font-medium">
                  {(parseFloat(formatAmount(order.amount)) * 0.03).toFixed(2)} XLM
                </Text>
              </div>
            </div>

            {/* Success Indicator */}
            <div className="flex items-center gap-2 pt-2 border-t">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <Text variant="bodySmall" muted>
                Successfully delivered and payment confirmed
              </Text>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
