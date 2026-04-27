"use client";

import { Suspense, useContext, useEffect, useState } from "react";
import type { Order } from "@/services/stellar/contractService";
import { WalletContext } from "@/context/WalletContext";
import { listOrdersAsBuyer } from "@/services/orderService";
import { useEscrowContract } from "@/hooks/useEscrowContract";
import OrderCard from "@/components/orders/OrderCard";
import CreateOrderForm from "@/components/orders/CreateOrderForm";
import { Card, CardContent, CardHeader, CardTitle, Text } from "@/components/ui";

function OrdersList() {
  const { address } = useContext(WalletContext);
  const { confirmReceipt, confirmState } = useEscrowContract();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOrders() {
      if (!address) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const result = await listOrdersAsBuyer(address);
        setOrders(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load orders");
      } finally {
        setLoading(false);
      }
    }
    loadOrders();
  }, [address]);

  const handleConfirm = async (orderId: string) => {
    try {
      await confirmReceipt(orderId);
      setOrders((prev) =>
        prev.map((order) =>
          order.orderId === orderId
            ? { ...order, status: "Completed" }
            : order,
        ),
      );
    } catch (err) {
      console.error("Failed to confirm receipt:", err);
    }
  };

  if (loading) {
    return <div className="text-center text-muted py-12">Loading orders...</div>;
  }

  if (!address) {
    return (
      <Card variant="elevated" padding="lg">
        <CardHeader>
          <CardTitle>My Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <Text variant="body" muted>
            Connect your wallet to view your orders.
          </Text>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card variant="elevated" padding="lg" className="border-red-200">
        <CardHeader>
          <CardTitle>Error</CardTitle>
        </CardHeader>
        <CardContent>
          <Text variant="body" className="text-red-600">
            {error}
          </Text>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {orders.length === 0 ? (
        <Card variant="elevated" padding="lg">
          <CardHeader>
            <CardTitle>No Orders Yet</CardTitle>
          </CardHeader>
          <CardContent>
            <Text variant="body" muted>
              Create your first order below to get started.
            </Text>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              isBuyer={true}
              onConfirm={handleConfirm}
              isConfirming={confirmState.isLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-foreground mb-2 text-center">
          Orders
        </h1>
        <p className="text-muted text-center mb-8">
          Create escrow-backed orders with farmers on the Stellar network.
        </p>

        <div className="space-y-8">
          <Suspense fallback={<div className="text-center text-muted">Loading...</div>}>
            <OrdersList />
          </Suspense>

          <div className="border-t pt-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">Create New Order</h2>
            <Suspense fallback={<div className="text-center text-muted">Loading...</div>}>
              <CreateOrderForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

