"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ShieldAlert,
  Wallet,
  Clock,
  Hash,
  RefreshCcw,
} from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import CopyButton from "@/components/shared/copy-button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWallet } from "@/hooks/useWallet";
import { useEscrowContract } from "@/hooks/useEscrowContract";
import { useSocket } from "@/hooks/useSocket";
import { getOrder, type Order } from "@/services/stellar/contractService";
import { formatTruncatedAddress } from "@/lib/helpers/format-address";
import CountdownTimer from "@/components/orders/CountdownTimer";
import DisputeForm from "@/components/orders/DisputeForm";
import { toast } from "sonner";

const EXPIRY_HOURS = 96;

export default function OrderDetailsPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId;

  const { address, connected } = useWallet();
  const { tx, confirmState, refundState, disputeState, confirmReceipt, requestRefund, openDispute } = useEscrowContract();
  const { on: onSocket } = useSocket();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [refundTxHash, setRefundTxHash] = useState<string | null>(null);
  const [confirmTxHash, setConfirmTxHash] = useState<string | null>(null);
  const [showDisputeDialog, setShowDisputeDialog] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isExpired, setIsExpired] = useState(false);

  // Tick expiry state outside render to keep it pure.
  useEffect(() => {
    if (!order?.createdAt) return;
    const expirySeconds = order.createdAt + EXPIRY_HOURS * 3600;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) {
        setIsExpired(Math.floor(Date.now() / 1000) >= expirySeconds);
      }
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

  // Real-time refresh when the backend's indexer reports a status change.
  useEffect(() => {
    if (!orderId) return;
    const cleanup = onSocket("order:status_changed", (payload: unknown) => {
      const p = payload as { orderId?: string | number };
      if (String(p?.orderId) === String(orderId)) {
        void fetchOrder();
      }
    });
    return cleanup;
  }, [orderId, onSocket, fetchOrder]);

  const isBuyer = useMemo(
    () =>
      Boolean(connected && address && order?.buyer && address === order.buyer),
    [connected, address, order?.buyer],
  );
  const isFarmer = useMemo(
    () =>
      Boolean(
        connected && address && order?.seller && address === order.seller,
      ),
    [connected, address, order?.seller],
  );

  const isPending = order?.status === "Pending";
  const canConfirm = isPending && isBuyer && !isExpired;
  const canRefund = isPending && isBuyer && isExpired;
  const canDispute = isPending && (isBuyer || isFarmer);

  const onConfirmReceipt = useCallback(async () => {
    if (!orderId) return;
    setActionError(null);
    try {
      const result = await tx.confirm(orderId);
      if (result.success && result.txHash) setConfirmTxHash(result.txHash);
      toast.success("Receipt confirmed successfully");
      await fetchOrder();
    } catch {
      const msg = tx.error || "Confirm receipt failed. Please try again.";
      setActionError(msg);
      toast.error(msg);
    }
  }, [orderId, tx, fetchOrder]);

  const onRequestRefund = useCallback(async () => {
    if (!orderId) return;
    setRefundTxHash(null);
    setActionError(null);
    try {
      const result = await tx.refund(orderId);
      if (result.success && result.txHash) setRefundTxHash(result.txHash);
      toast.success("Refund processed successfully");
      await fetchOrder();
    } catch {
      const msg = tx.error || "Refund failed. Please try again.";
      setActionError(msg);
      toast.error(msg);
    }
  }, [orderId, tx, fetchOrder]);

  const onOpenDispute = useCallback(
    async (reason: string, evidence: string) => {
      if (!orderId) return;
      setActionError(null);
      try {
        await tx.dispute(orderId, reason, evidence);
        setShowDisputeDialog(false);
        toast.success("Dispute opened successfully");
        await fetchOrder();
      } catch {
        const msg = tx.error || "Opening dispute failed. Please try again.";
        setActionError(msg);
        toast.error(msg);
      }
    },
    [orderId, tx, fetchOrder],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Wrapper className="pt-32 pb-20 md:pt-40">
        <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </Wrapper>
    );
  }

  if (error || !order) {
    return (
      <Wrapper className="pt-32 pb-20 md:pt-40">
        <Card>
          <CardContent className="py-10 text-center">
            <h2 className="text-lg font-semibold">Order not found</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {error ?? "We couldn't find this order."}
            </p>
            <Link
              href="/orders"
              className={buttonVariants({
                variant: "outline",
                className: "mt-4",
              })}
            >
              <ArrowLeft className="size-4" />
              Back to orders
            </Link>
          </CardContent>
        </Card>
      </Wrapper>
    );
  }

  const totalXlm = (Number(order.amount) / 1e7).toFixed(2);
  const createdAtLabel = order.createdAt
    ? new Date(order.createdAt * 1000).toLocaleString()
    : "—";

  return (
    <Wrapper className="pt-32 pb-20 md:pt-40">
      <nav className="text-muted-foreground mb-6 flex items-center gap-2 text-sm">
        <Link href="/orders" className="hover:text-foreground">
          Orders
        </Link>
        <span>/</span>
        <span className="text-foreground">#{order.orderId}</span>
      </nav>

      <PageHeader title={`Order #${order.orderId}`}>
        <StatusBadge status={order.status} />
      </PageHeader>

      <div className="mt-8 grid gap-6 md:grid-cols-[2fr_1fr]">
        {/* Left: order info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Parties</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <AddressBlock label="Buyer" address={order.buyer} />
              <AddressBlock label="Farmer" address={order.seller} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Escrow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Metric
                  label="Amount locked"
                  value={`${totalXlm} XLM`}
                  highlight
                />
                <Metric label="Created" value={createdAtLabel} />
                <Metric
                  label="Expiry"
                  value={
                    isPending ? (
                      <CountdownTimer createdAt={order.createdAt} />
                    ) : (
                      "—"
                    )
                  }
                />
              </div>

              {(confirmTxHash || refundTxHash) && (
                <>
                  <Separator />
                  <div className="grid gap-3 text-xs">
                    {confirmTxHash && (
                      <TxRow label="Confirm tx" hash={confirmTxHash} />
                    )}
                    {refundTxHash && (
                      <TxRow label="Refund tx" hash={refundTxHash} />
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {order.status === "Disputed" && (
            <Card className="border-destructive/30">
              <CardContent className="flex items-start gap-3 py-4">
                <ShieldAlert className="text-destructive mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">Dispute opened</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    An admin is reviewing this dispute and will resolve it via
                    Refund, Release, or Split.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: actions */}
        <div className="space-y-4 md:sticky md:top-32 md:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!connected ? (
                <div className="bg-secondary/50 flex items-start gap-2 rounded-lg p-3 text-sm">
                  <Wallet className="mt-0.5 size-4 shrink-0" />
                  <span>Connect your wallet to act on this order.</span>
                </div>
              ) : !isBuyer && !isFarmer ? (
                <p className="text-muted-foreground text-sm">
                  You&apos;re not a party on this order, so no actions are
                  available.
                </p>
              ) : (
                <>
                  {canConfirm && (
                    <Button
                      onClick={() => void onConfirmReceipt()}
                      isLoading={tx.isLoading && tx.activeAction === "confirm"}
                      className="w-full"
                    >
                      <CheckCircle2 className="size-4" />
                      Confirm Receipt
                    </Button>
                  )}

                  {canRefund && (
                    <Button
                      variant="destructive"
                      onClick={() => void onRequestRefund()}
                      isLoading={tx.isLoading && tx.activeAction === "refund"}
                      className="w-full"
                    >
                      <RefreshCcw className="size-4" />
                      Refund (Expired)
                    </Button>
                  )}

                  {canDispute && (
                    <Button
                      variant="outline"
                      onClick={() => setShowDisputeDialog(true)}
                      className="w-full"
                    >
                      <ShieldAlert className="size-4" />
                      Open Dispute
                    </Button>
                  )}

                  {!isPending && (
                    <p className="text-muted-foreground text-sm">
                      This order is{" "}
                      <span className="font-medium">{order.status}</span>. No
                      further on-chain actions are available.
                    </p>
                  )}

                  {actionError && (
                    <p className="text-destructive text-xs" role="alert">
                      {actionError}
                    </p>
                  )}
                  {!actionError && confirmState.error && (
                    <p className="text-destructive text-xs">
                      {confirmState.error}
                    </p>
                  )}
                  {!actionError && refundState.error && (
                    <p className="text-destructive text-xs">
                      {refundState.error}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 py-4 text-xs">
              <p className="text-muted-foreground flex items-center gap-1.5">
                <Clock className="size-3.5" />
                Orders expire {EXPIRY_HOURS}h after creation. If not confirmed,
                buyers can refund the escrow.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showDisputeDialog} onOpenChange={setShowDisputeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Open Dispute</DialogTitle>
            <DialogDescription>
              Describe the problem. An admin will review and resolve as Refund,
              Release, or Split.
            </DialogDescription>
          </DialogHeader>
          <DisputeForm
            isLoading={disputeState.isLoading}
            error={disputeState.error}
            onSubmit={onOpenDispute}
            onCancel={() => setShowDisputeDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </Wrapper>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function AddressBlock({
  label,
  address,
}: {
  label: string;
  address: string | null | undefined;
}) {
  if (!address) {
    return (
      <div>
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="text-sm">—</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="flex items-center gap-2">
        <p className="font-mono text-sm">{formatTruncatedAddress(address)}</p>
        <CopyButton
          text={address}
          className="text-muted-foreground hover:text-foreground inline-flex items-center"
          iconClassName="!size-3.5"
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <div
        className={
          highlight
            ? "mt-0.5 text-lg font-semibold"
            : "mt-0.5 text-sm font-medium"
        }
      >
        {value}
      </div>
    </div>
  );
}

function TxRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground flex items-center gap-1">
        <Hash className="size-3" />
        {label}
      </p>
      <div className="flex items-center gap-2">
        <p className="font-mono break-all">{hash}</p>
        <CopyButton
          text={hash}
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center"
          iconClassName="!size-3.5"
        />
      </div>
    </div>
  );
}
