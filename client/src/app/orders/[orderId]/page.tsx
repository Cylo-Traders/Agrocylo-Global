"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Container, Text, Button, Badge } from "@/components/ui";
import { getOrder, type Order } from "@/services/stellar/contractService";
import { useWallet } from "@/hooks/useWallet";
import { useEscrowContract } from "@/hooks/useEscrowContract";
import { useSocket } from "@/hooks/useSocket";
import DisputeForm from "@/components/orders/DisputeForm";
import CountdownTimer from "@/components/orders/CountdownTimer";

export default function OrderDetailsPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params?.orderId;

  const { address, connected } = useWallet();
  const { confirmReceipt, confirmState } = useEscrowContract();
  const { requestRefund, refundState } = useEscrowContract();
  const { openDispute, disputeState } = useEscrowContract();
  const { on: onSocket } = useSocket();

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

  const [refundTxHash, setRefundTxHash] = useState<string | null>(null);
  const [showDisputeForm, setShowDisputeForm] = useState(false);

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

  // Real-time updates
  useEffect(() => {
    if (!orderId) return;
    
    const cleanup = onSocket("order:status_changed", (payload: any) => {
      if (String(payload.orderId) === String(orderId)) {
        console.log("[OrderDetails] Real-time status update:", payload.status);
        void fetchOrder();
      }
    });

    return cleanup;
  }, [orderId, onSocket, fetchOrder]);

  const deliveryExpiryTsSeconds = useMemo(() => {
    if (!order || order.createdAt == null) return null;
    const createdAtSeconds = Number(order.createdAt);
    if (!Number.isFinite(createdAtSeconds)) return null;
    return createdAtSeconds + EXPIRY_HOURS * 3600;
  }, [order]);

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

  const canDispute = useMemo(() => {
    return (
      !!orderId &&
      connected &&
      (order?.status === "Pending" || order?.status === "Delivered") &&
      !disputeState.isLoading
    );
  }, [orderId, connected, order?.status, disputeState.isLoading]);

  const onOpenDispute = useCallback(
    async (reason: string, evidence: string) => {
      if (!orderId) return;
      try {
        await openDispute(orderId, reason, evidence);
        setShowDisputeForm(false);
        await fetchOrder();
      } catch {
        // disputeState.error is already set by the hook
      }
    },
    [orderId, openDispute, fetchOrder]
  );

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

  const renderStatus = () => {
    if (!order) return "-";
    const status = order.status;
    
    switch (status) {
      case "Pending":
        return <Badge variant="warning">Pending</Badge>;
      case "Delivered":
        return <Badge variant="primary">Delivered</Badge>;
      case "Completed":
        return <Badge variant="success">Completed</Badge>;
      case "Refunded":
        return <Badge variant="error">Refunded</Badge>;
      case "Disputed":
        return <Badge variant="danger">Disputed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Container size="lg" className="py-8">
      <Card variant="elevated" padding="lg">
        <CardHeader>
          <CardTitle className="text-base font-bold">Order #{orderId}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Text variant="body" muted>Loading order...</Text>
          ) : error ? (
            <Text variant="body" className="text-error font-medium">{error}</Text>
          ) : order ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Text variant="body" muted className="font-semibold">Buyer</Text>
                  <Text variant="body" className="block font-mono text-xs break-all bg-muted/30 p-1 rounded mt-1">{order.buyer ?? "-"}</Text>
                </div>
                <div>
                  <Text variant="body" muted className="font-semibold">Seller</Text>
                  <Text variant="body" className="block font-mono text-xs break-all bg-muted/30 p-1 rounded mt-1">{order.seller ?? "-"}</Text>
                </div>
              </div>

              <div className="flex flex-wrap gap-6 pt-2">
                <div>
                  <Text variant="body" muted className="font-semibold">Amount</Text>
                  <Text variant="body" className="block font-bold text-lg">{String(order.amount ?? "-")} XLM</Text>
                </div>
                <div>
                  <Text variant="body" muted className="font-semibold">Status</Text>
                  <div className="mt-1">{renderStatus()}</div>
                </div>
                <div>
                  <Text variant="body" muted className="font-semibold">Created</Text>
                  <Text variant="body" className="block mt-1">
                    {order.createdAt ? new Date(Number(order.createdAt) * 1000).toLocaleString() : "-"}
                  </Text>
                </div>
              </div>

              {order.status === "Pending" && (
                <div className="pt-3 border-t border-border/60">
                  <Text variant="body" muted className="font-semibold">Delivery deadline</Text>
                  {order.createdAt != null ? (
                    <div className="mt-1">
                      <CountdownTimer createdAt={Number(order.createdAt)} />
                    </div>
                  ) : (
                    <Text variant="body" className="block">-</Text>
                  )}
                </div>
              )}

              {order.status === "Pending" && isExpired && isBuyer && (
                <div className="pt-2 space-y-2">
                  <Button
                    variant="danger"
                    size="lg"
                    onClick={() => void onRequestRefund()}
                    disabled={!canRefund}
                    isLoading={refundState.isLoading}
                    className="w-full font-bold"
                  >
                    Request Refund (Expired)
                  </Button>

                  {refundState.error ? (
                    <Text variant="body" className="text-error text-xs italic">
                      {refundState.error}
                    </Text>
                  ) : null}

                  {refundTxHash ? (
                    <Text variant="body" muted className="break-all text-[10px] font-mono bg-muted/20 p-2 rounded">
                      Refund tx: {refundTxHash}
                    </Text>
                  ) : null}
                </div>
              )}

              {canDispute && (
                <div className="pt-2 space-y-2 border-t border-border/60 mt-4">
                  {!showDisputeForm ? (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => setShowDisputeForm(true)}
                      className="w-full border-danger/40 text-danger hover:bg-danger/5"
                    >
                      Open Dispute
                    </Button>
                  ) : (
                    <div className="bg-muted/10 p-3 rounded-lg border border-border/40">
                      <Text variant="body" className="font-bold text-danger mb-2">Dispute Order</Text>
                      <DisputeForm
                        isLoading={disputeState.isLoading}
                        error={disputeState.error}
                        onSubmit={onOpenDispute}
                        onCancel={() => setShowDisputeForm(false)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <Text variant="body" muted>No order found.</Text>
          )}

          <div className="pt-4 flex justify-between items-center border-t border-border/40">
            <Button variant="outline" size="sm" onClick={() => router.back()}>
              ← Go Back
            </Button>
            {order?.status === "Disputed" && (
              <Text variant="body" className="text-xs italic text-muted-foreground">
                An admin will review this dispute shortly.
              </Text>
            )}
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}

