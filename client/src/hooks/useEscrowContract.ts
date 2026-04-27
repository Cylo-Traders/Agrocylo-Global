"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  createOrder as buildCreateOrder,
  confirmDelivery as buildConfirmDelivery,
  refundOrder as buildRefundOrder,
  openDispute as buildOpenDispute,
  getOrder,
  type Order,
} from "@/services/stellar/contractService";

interface ActionState {
  isLoading: boolean;
  error: string | null;
}

export function useEscrowContract() {
  const { address, signAndSubmit } = useWallet();
  const [createState, setCreateState] = useState<ActionState>({ isLoading: false, error: null });
  const [confirmState, setConfirmState] = useState<ActionState>({ isLoading: false, error: null });
  const [refundState, setRefundState] = useState<ActionState>({ isLoading: false, error: null });
  const [disputeState, setDisputeState] = useState<ActionState>({ isLoading: false, error: null });
  const [resolveState, setResolveState] = useState<ActionState>({ isLoading: false, error: null });
  const [splitState, setSplitState] = useState<ActionState>({ isLoading: false, error: null });
  const [queryState, setQueryState] = useState<ActionState>({ isLoading: false, error: null });

  const createOrder = useCallback(
    async (farmerAddress: string, tokenAddress: string, amount: bigint, deliveryDeadline?: string) => {
      if (!address) throw new Error("Wallet not connected");
      setCreateState({ isLoading: true, error: null });
      try {
        const result = await buildCreateOrder(address, farmerAddress, tokenAddress, amount, deliveryDeadline);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          throw new Error(submitResult.error ?? "Transaction failed");
        }
        setCreateState({ isLoading: false, error: null });
        return submitResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setCreateState({ isLoading: false, error: msg });
        throw err;
      }
    },
    [address, signAndSubmit]
  );

  const confirmReceipt = useCallback(
    async (orderId: string) => {
      if (!address) throw new Error("Wallet not connected");
      setConfirmState({ isLoading: true, error: null });
      try {
        const result = await buildConfirmDelivery(address, orderId);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          throw new Error(submitResult.error ?? "Transaction failed");
        }
        setConfirmState({ isLoading: false, error: null });
        return submitResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setConfirmState({ isLoading: false, error: msg });
        throw err;
      }
    },
    [address, signAndSubmit]
  );

  const requestRefund = useCallback(
    async (orderId: string) => {
      if (!address) throw new Error("Wallet not connected");
      setRefundState({ isLoading: true, error: null });
      try {
        const result = await buildRefundOrder(address, orderId);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          throw new Error(submitResult.error ?? "Transaction failed");
        }
        setRefundState({ isLoading: false, error: null });
        return submitResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRefundState({ isLoading: false, error: msg });
        throw err;
      }
    },
    [address, signAndSubmit]
  );

  const openDispute = useCallback(
    async (orderId: string, reason: string, evidence: string) => {
      if (!address) throw new Error("Wallet not connected");
      setDisputeState({ isLoading: true, error: null });
      try {
        const result = await buildOpenDispute(address, orderId, reason, evidence);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          throw new Error(submitResult.error ?? "Transaction failed");
        }
        setDisputeState({ isLoading: false, error: null });
        return submitResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setDisputeState({ isLoading: false, error: msg });
        throw err;
      }
    },
    [address, signAndSubmit]
  );

  const resolveDispute = useCallback(
    async (orderId: string, resolveToBuyer: boolean) => {
      if (!address) throw new Error("Wallet not connected");
      setResolveState({ isLoading: true, error: null });
      try {
        const { resolveDispute: buildResolveDispute } = await import("@/services/stellar/contractService");
        const result = await buildResolveDispute(address, orderId, resolveToBuyer);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          throw new Error(submitResult.error ?? "Transaction failed");
        }
        setResolveState({ isLoading: false, error: null });
        return submitResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setResolveState({ isLoading: false, error: msg });
        throw err;
      }
    },
    [address, signAndSubmit]
  );

  const splitFunds = useCallback(
    async (orderId: string, buyerShare: bigint, farmerShare: bigint) => {
      if (!address) throw new Error("Wallet not connected");
      setSplitState({ isLoading: true, error: null });
      try {
        const { splitFunds: buildSplitFunds } = await import("@/services/stellar/contractService");
        const result = await buildSplitFunds(address, orderId, buyerShare, farmerShare);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          throw new Error(submitResult.error ?? "Transaction failed");
        }
        setSplitState({ isLoading: false, error: null });
        return submitResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSplitState({ isLoading: false, error: msg });
        throw err;
      }
    },
    [address, signAndSubmit]
  );

  const getOrderDetails = useCallback(
    async (orderId: string): Promise<Order | null> => {
      setQueryState({ isLoading: true, error: null });
      try {
        const result = await getOrder(orderId);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Order not found");
        }
        setQueryState({ isLoading: false, error: null });
        return result.data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setQueryState({ isLoading: false, error: msg });
        return null;
      }
    },
    []
  );

  return {
    createOrder,
    confirmReceipt,
    requestRefund,
    openDispute,
    resolveDispute,
    splitFunds,
    getOrderDetails,
    createState,
    confirmState,
    refundState,
    disputeState,
    resolveState,
    splitState,
    queryState,
  };
}
