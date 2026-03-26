"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Container, Text, Button } from "@/components/ui";
import { getOrder, type Order } from "@/services/stellar/contractService";
import { useWallet } from "@/hooks/useWallet";
import { useEscrowContract } from "@/hooks/useEscrowContract";

export default function OrderDetailsPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params?.orderId;

  const { address, connected } = useWallet();
  const { confirmReceipt, confirmState } = useEscrowContract();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [confirmTxHash, setConfirmTxHash] = useState<string | null>(null);

  // The on-chain contract treats an order as expired after 96 hours from creation.
  const EXPIRY_HOURS = 96;
  const [isExpired, setIsExpired] = useState(false);

  // Keep expiry state updated outside render (avoid impure Date.now() during render).
  useEffect(() => {
    if (!order?.createdAt) return;

    const expiryTimeSeconds = order.createdAt + EXPIRY_HOURS * 3600;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setIsExpired(Math.floor(Date.now() / 1000) >= expiryTimeSeconds);
    };

    tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [order?.createdAt]);

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

  const isBuyer = useMemo(() => {
    if (!connected || !address) return false;
    if (!order?.buyer) return false;
    return address === order.buyer;
  }, [connected, address, order?.buyer]);

  const canConfirm = useMemo(() => {
    return (
      !!orderId &&
      isBuyer &&
      order?.status === "Pending" &&
      !isExpired &&
      !confirmState.isLoading
    );
  }, [orderId, isBuyer, order?.status, isExpired, confirmState.isLoading]);

  const onConfirmDelivery = useCallback(async () => {
    if (!orderId) return;
    setConfirmTxHash(null);
    try {
      const result = await confirmReceipt(orderId);
      if (result.success && result.txHash) {
        setConfirmTxHash(result.txHash);
      }
      // Refresh so UI updates order.status to `Completed`.
      await fetchOrder();
    } catch {
      // `confirmState.error` is handled via the hook state.
    }
  }, [confirmReceipt, fetchOrder, orderId]);

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

              {order.status === "Pending" && isBuyer && !isExpired && (
                <div className="pt-2 space-y-2">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => void onConfirmDelivery()}
                    disabled={!canConfirm}
                    isLoading={confirmState.isLoading}
                    className="w-full"
                  >
                    Confirm Delivery
                  </Button>

                  {confirmState.error ? (
                    <Text variant="body" className="text-error">
                      {confirmState.error}
                    </Text>
                  ) : null}

                  {confirmTxHash ? (
                    <Text variant="body" muted className="break-all text-xs">
                      Confirm tx: {confirmTxHash}
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

