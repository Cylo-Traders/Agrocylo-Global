"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Container, Text, Button } from "@/components/ui";
import { getOrder } from "@/services/stellar/contractService";

export default function OrderDetailsPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await getOrder(orderId);
        if (cancelled) return;
        if (!res.success || !res.data) {
          throw new Error(res.error || "Failed to fetch order");
        }
        setOrder(res.data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load order.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <Container size="lg" className="py-8">
      <Card variant="elevated" padding="lg">
        <CardHeader>
          <CardTitle className="text-base">Order #{orderId}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Text variant="body" muted>Loading order...</Text>
          ) : error ? (
            <Text variant="body" className="text-error">{error}</Text>
          ) : order ? (
            <div className="space-y-2 text-sm">
              <div><Text variant="body" muted>Buyer</Text><Text variant="body" className="block">{order.buyer ?? "-"}</Text></div>
              <div><Text variant="body" muted>Seller</Text><Text variant="body" className="block">{order.seller ?? "-"}</Text></div>
              <div><Text variant="body" muted>Amount</Text><Text variant="body" className="block">{String(order.amount ?? "-")}</Text></div>
              <div><Text variant="body" muted>Status</Text><Text variant="body" className="block">{order.status ?? "-"}</Text></div>
              <div><Text variant="body" muted>Created</Text><Text variant="body" className="block">{order.createdAt ?? "-"}</Text></div>
            </div>
          ) : (
            <Text variant="body" muted>No order found.</Text>
          )}

          <div className="pt-2">
            <Button variant="outline" onClick={() => history.back()}>
              Back
            </Button>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}

