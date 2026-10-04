"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DisputeForm from "@/components/orders/DisputeForm";
import { useOrderDetails } from "./hooks/useOrderDetails";
import { OrderActionsCard } from "./components/OrderActionsCard";
import { OrderInfoSection } from "./components/OrderInfoSection";

export default function OrderDetailsPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId;
  const [showDisputeDialog, setShowDisputeDialog] = useState(false);

  const {
    loading,
    error,
    order,
    refundTxHash,
    confirmTxHash,
    actionError,
    milestoneIndex,
    advancingMilestone,
    provenance,
    provenanceLoading,
    isBuyer,
    isFarmer,
    isPending,
    canConfirm,
    canRefund,
    canDispute,
    onConfirmReceipt,
    onRequestRefund,
    onOpenDispute,
    onAdvanceMilestone,
    confirmState,
    refundState,
    disputeState,
    tx,
    EXPIRY_HOURS,
    connected,
  } = useOrderDetails(orderId);

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
        <OrderInfoSection
          order={order}
          totalXlm={totalXlm}
          createdAtLabel={createdAtLabel}
          isPending={isPending}
          confirmTxHash={confirmTxHash}
          refundTxHash={refundTxHash}
          milestoneIndex={milestoneIndex}
          isFarmer={isFarmer}
          onAdvanceMilestone={onAdvanceMilestone}
          advancingMilestone={advancingMilestone}
          provenance={provenance}
          provenanceLoading={provenanceLoading}
        />

        <OrderActionsCard
          connected={connected}
          isBuyer={isBuyer}
          isFarmer={isFarmer}
          isPending={isPending}
          canConfirm={canConfirm}
          canRefund={canRefund}
          canDispute={canDispute}
          status={order.status}
          onConfirm={onConfirmReceipt}
          onRefund={onRequestRefund}
          onOpenDispute={() => setShowDisputeDialog(true)}
          confirmLoading={tx.isLoading && tx.activeAction === "confirm"}
          refundLoading={tx.isLoading && tx.activeAction === "refund"}
          actionError={actionError}
          confirmStateError={confirmState.error}
          refundStateError={refundState.error}
          expiryHours={EXPIRY_HOURS}
        />
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
            onSubmit={async (reason, evidence) => {
              const success = await onOpenDispute(reason, evidence);
              if (success) setShowDisputeDialog(false);
            }}
            onCancel={() => setShowDisputeDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </Wrapper>
  );
}
