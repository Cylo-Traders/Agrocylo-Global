"use client";

import { useState, useContext } from "react";
import { WalletContext } from "@/context/WalletContext";
import { refundOrder } from "@/lib/escrow";
import type { Order } from "@/types/order";
import { Button, Card, Text, Container } from "@/components/ui";

export default function OrdersPage() {
  const { address, connected, connect } = useContext(WalletContext);

  const [orders, setOrders] = useState<Order[]>([
    {
      id: 1,
      buyer: address ?? "you",
      farmer: "farmer1",
      amount: "500",
      timestamp: Date.now() - 100 * 60 * 60 * 1000,
      status: "Pending",
    },
  ]);

  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isExpired = (timestamp: number) => {
    const expiryTime = timestamp + 96 * 60 * 60 * 1000;
    return Date.now() > expiryTime;
  };

  async function handleRefund(orderId: number) {
    try {
      setLoadingId(orderId);
      setMessage(null);
      setErrorMessage(null);

      await refundOrder(orderId);

      setOrders((prev) =>
        prev.map((order) =>
          order.id === orderId ? { ...order, status: "Refunded" } : order
        )
      );

      setMessage(`Order #${orderId} refunded successfully.`);
    } catch (error) {
      console.error("Refund failed:", error);
      setErrorMessage("Refund failed. Please try again.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground py-10">
      <Container size="lg">
        <Text variant="h2" as="h1" className="mb-6">
          Your Orders
        </Text>

        {!connected && (
          <div className="mb-4">
            <Button variant="primary" onClick={connect}>
              Connect Wallet
            </Button>
          </div>
        )}

        {message && <Text className="mb-4">{message}</Text>}
        {errorMessage && <Text className="mb-4">{errorMessage}</Text>}

        <div className="space-y-4">
          {orders.map((order) => (
            <Card key={order.id} variant="elevated" padding="md">
              <div className="space-y-2">
                <Text>Order ID: {order.id}</Text>
                <Text>Buyer: {order.buyer}</Text>
                <Text>Farmer: {order.farmer}</Text>
                <Text>Amount: {order.amount}</Text>
                <Text>Status: {order.status}</Text>
              </div>

              {order.status === "Pending" &&
                isExpired(order.timestamp) &&
                order.buyer === address && (
                  <div className="mt-4">
                    <Button
                      variant="primary"
                      onClick={() => handleRefund(order.id)}
                      disabled={loadingId === order.id}
                    >
                      {loadingId === order.id
                        ? "Refunding..."
                        : "Request Refund"}
                    </Button>
                  </div>
                )}
            </Card>
          ))}
        </div>
      </Container>
    </main>
  );
}