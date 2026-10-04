"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useEscrowContract } from "@/hooks/useEscrowContract";
import { useSocket } from "@/hooks/useSocket";
import { getOrder, type Order } from "@/services/stellar/contractService";
import { fetchOrderProvenance } from "@/services/provenanceService";
import type { ProvenanceRecord } from "@/types/provenance";
import { toast } from "sonner";

const EXPIRY_HOURS = 96;

export function useOrderDetails(orderId: string | undefined) {
  const { address, connected } = useWallet();
  const { tx, confirmState, refundState, disputeState } = useEscrowContract();
  const { on: onSocket } = useSocket();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [refundTxHash, setRefundTxHash] = useState<string | null>(null);
  const [confirmTxHash, setConfirmTxHash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isExpired, setIsExpired] = useState(false);
  const [milestoneIndex, setMilestoneIndex] = useState<number>(-1);
  const [advancingMilestone, setAdvancingMilestone] = useState(false);
  const [provenance, setProvenance] = useState<ProvenanceRecord | null>(null);
  const [provenanceLoading, setProvenanceLoading] = useState(true);

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

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setProvenanceLoading(true);
    void fetchOrderProvenance(orderId)
      .then((rec) => {
        if (!cancelled) setProvenance(rec);
      })
      .finally(() => {
        if (!cancelled) setProvenanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

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
        toast.success("Dispute opened successfully");
        await fetchOrder();
        return true;
      } catch {
        const msg = tx.error || "Opening dispute failed. Please try again.";
        setActionError(msg);
        toast.error(msg);
        return false;
      }
    },
    [orderId, tx, fetchOrder],
  );

  const onAdvanceMilestone = useCallback(async () => {
    if (!isFarmer) return;
    setAdvancingMilestone(true);
    try {
      setMilestoneIndex((prev) => Math.min(prev + 1, 4));
      toast.success("Milestone advanced");
    } finally {
      setAdvancingMilestone(false);
    }
  }, [isFarmer]);

  return {
    loading,
    error,
    order,
    refundTxHash,
    confirmTxHash,
    actionError,
    isExpired,
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
  };
}
