"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Container, Text, Button } from "@/components/ui";
import { getOrder, type Order } from "@/services/stellar/contractService";
import CountdownTimer from "@/components/orders/CountdownTimer";
import { useWallet } from "@/hooks/useWallet";
import { useEscrowContract } from "@/hooks/useEscrowContract";

export default function OrderDetailsPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params?.orderId;

  const { address, connected } = useWallet();
  const { requestRefund, refundState } = useEscrowContract();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);

  const [refundTxHash, setRefundTxHash] = useState<string | null>(null);

  const EXPIRY_HOURS = 96;

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getOrder(orderId);
      if (!res.success || !res.data) {
        throw new Error(res.error || "Failed to fetch order");
      }
      setOrder(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  const deliveryExpiryTsSeconds = useMemo(() => {
    if (!order || order.createdAt == null) return null;
    const createdAtSeconds = Number(order.createdAt);
    if (!Number.isFinite(createdAtSeconds)) return null;
    return createdAtSeconds + EXPIRY_HOURS * 3600;
  }, [order]);

  const isExpired = useMemo(() => {
    if (deliveryExpiryTsSeconds == null) return false;
    return Math.floor(Date.now() / 1000) >= deliveryExpiryTsSeconds;
  }, [deliveryExpiryTsSeconds]);

  const isBuyer = useMemo(() => {
    if (!connected || !address) return false;
    if (!order?.buyer) return false;
    return address === order.buyer;
  }, [connected, address, order?.buyer]);

  const canRefund = useMemo(() => {
    return (
      !!orderId &&
      isBuyer &&
      order?.status === "Pending" &&
      isExpired &&
      !refundState.isLoading
    );
  }, [orderId, isBuyer, order?.status, isExpired, refundState.isLoading]);

  const onRequestRefund = useCallback(async () => {
    if (!orderId) return;
    setRefundTxHash(null);
    try {
      const result = await requestRefund(orderId);
      if (result.success && result.txHash) {
        setRefundTxHash(result.txHash);
      }
      // Refresh to update `order.status` to `Refunded`.
      await fetchOrder();
    } catch {
      // `refundState.error` is already set by the hook.
    }
  }, [fetchOrder, orderId, requestRefund]);

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

              <div className="pt-2">
                <Text variant="body" muted>Delivery deadline</Text>
                {order.createdAt != null ? (
                  <div className="mt-1">
                    <CountdownTimer createdAt={Number(order.createdAt)} />
                  </div>
                ) : (
                  <Text variant="body" className="block">-</Text>
                )}
              </div>

              {order.status === "Pending" && isExpired && isBuyer && (
                <div className="pt-2 space-y-2">
                  <Button
                    variant="danger"
                    size="lg"
                    onClick={() => void onRequestRefund()}
                    disabled={!canRefund}
                    isLoading={refundState.isLoading}
                    className="w-full"
                  >
                    Request Refund
                  </Button>

                  {refundState.error ? (
                    <Text variant="body" className="text-error">
                      {refundState.error}
                    </Text>
                  ) : null}

                  {refundTxHash ? (
                    <Text variant="body" muted className="break-all text-xs">
                      Refund tx: {refundTxHash}
                    </Text>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <Text variant="body" muted>No order found.</Text>
          )}

          <div className="pt-2">
            <Button variant="outline" onClick={() => router.back()}>
              Back
            </Button>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}

