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
import { isTestMode } from "@/lib/testMode";
import { mapBlockchainError, type BlockchainErrorInfo } from "@/lib/blockchainError";

interface ActionState {
  isLoading: boolean;
  error: string | null;
  blockchainError: BlockchainErrorInfo | null;
}

export interface TransactionApi {
  /** Unified loading state — true when any transaction action is in flight. */
  isLoading: boolean;
  /** Unified error — the most recent error from any action. */
  error: string | null;
  /** Structured blockchain error info, or null when idle. */
  blockchainError: BlockchainErrorInfo | null;
  /** The action type that caused the current state, or null when idle. */
  activeAction: "confirm" | "refund" | "dispute" | null;
  /** Clear the unified error. */
  clearError: () => void;
  confirm: (orderId: string) => Promise<{ success: boolean; txHash?: string }>;
  refund: (orderId: string) => Promise<{ success: boolean; txHash?: string }>;
  dispute: (orderId: string, reason: string, evidence: string) => Promise<{ success: boolean }>;
}

function classifySubmitError(error: unknown): BlockchainErrorInfo {
  const err = error instanceof Error ? error : new Error(String(error));
  return mapBlockchainError(err);
}

function toMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useEscrowContract() {
  const { address, signAndSubmit } = useWallet();
  const [createState, setCreateState] = useState<ActionState>({ isLoading: false, error: null, blockchainError: null });
  const [confirmState, setConfirmState] = useState<ActionState>({ isLoading: false, error: null, blockchainError: null });
  const [refundState, setRefundState] = useState<ActionState>({ isLoading: false, error: null, blockchainError: null });
  const [disputeState, setDisputeState] = useState<ActionState>({ isLoading: false, error: null, blockchainError: null });
  const [resolveState, setResolveState] = useState<ActionState>({ isLoading: false, error: null, blockchainError: null });
  const [splitState, setSplitState] = useState<ActionState>({ isLoading: false, error: null, blockchainError: null });
  const [queryState, setQueryState] = useState<ActionState>({ isLoading: false, error: null, blockchainError: null });
  const [activeAction, setActiveAction] = useState<TransactionApi["activeAction"]>(null);

  const createOrder = useCallback(
    async (farmerAddress: string, tokenAddress: string, amount: bigint, deliveryDeadline?: string) => {
      if (!address) throw new Error("Wallet not connected");
      setCreateState({ isLoading: true, error: null, blockchainError: null });
      try {
        const result = await buildCreateOrder(address, farmerAddress, tokenAddress, amount, deliveryDeadline);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          const errInfo = classifySubmitError(submitResult.error ?? "Transaction failed");
          setCreateState({ isLoading: false, error: submitResult.error ?? errInfo.message, blockchainError: errInfo });
          throw new Error(submitResult.error ?? errInfo.message);
        }
        setCreateState({ isLoading: false, error: null, blockchainError: null });
        return submitResult;
      } catch (err) {
        const errInfo = classifySubmitError(err);
        setCreateState({ isLoading: false, error: toMsg(err), blockchainError: errInfo });
        throw err;
      }
    },
    [address, signAndSubmit]
  );

  const confirmReceipt = useCallback(
    async (orderId: string) => {
      if (!address) throw new Error("Wallet not connected");
      setActiveAction("confirm");
      setConfirmState({ isLoading: true, error: null, blockchainError: null });
      try {
        if (isTestMode()) {
          const mocked = {
            success: true,
            txHash:
              "0000000000000000000000000000000000000000000000000000000000000001",
            status: "SUCCESS",
          };
          setConfirmState({ isLoading: false, error: null, blockchainError: null });
          return mocked;
        }

        const result = await buildConfirmDelivery(address, orderId);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          const errInfo = classifySubmitError(submitResult.error ?? "Transaction failed");
          setConfirmState({ isLoading: false, error: submitResult.error ?? errInfo.message, blockchainError: errInfo });
          throw new Error(submitResult.error ?? errInfo.message);
        }
        setConfirmState({ isLoading: false, error: null, blockchainError: null });
        return submitResult;
      } catch (err) {
        const errInfo = classifySubmitError(err);
        setConfirmState({ isLoading: false, error: toMsg(err), blockchainError: errInfo });
        throw err;
      } finally {
        setActiveAction(null);
      }
    },
    [address, signAndSubmit]
  );

  const requestRefund = useCallback(
    async (orderId: string) => {
      if (!address) throw new Error("Wallet not connected");
      setActiveAction("refund");
      setRefundState({ isLoading: true, error: null, blockchainError: null });
      try {
        const result = await buildRefundOrder(address, orderId);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          const errInfo = classifySubmitError(submitResult.error ?? "Transaction failed");
          setRefundState({ isLoading: false, error: submitResult.error ?? errInfo.message, blockchainError: errInfo });
          throw new Error(submitResult.error ?? errInfo.message);
        }
        setRefundState({ isLoading: false, error: null, blockchainError: null });
        return submitResult;
      } catch (err) {
        const errInfo = classifySubmitError(err);
        setRefundState({ isLoading: false, error: toMsg(err), blockchainError: errInfo });
        throw err;
      } finally {
        setActiveAction(null);
      }
    },
    [address, signAndSubmit]
  );

  const openDispute = useCallback(
    async (orderId: string, reason: string, evidence: string) => {
      if (!address) throw new Error("Wallet not connected");
      setActiveAction("dispute");
      setDisputeState({ isLoading: true, error: null, blockchainError: null });
      try {
        const result = await buildOpenDispute(address, orderId, reason, evidence);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          const errInfo = classifySubmitError(submitResult.error ?? "Transaction failed");
          setDisputeState({ isLoading: false, error: submitResult.error ?? errInfo.message, blockchainError: errInfo });
          throw new Error(submitResult.error ?? errInfo.message);
        }
        setDisputeState({ isLoading: false, error: null, blockchainError: null });
        return submitResult;
      } catch (err) {
        const errInfo = classifySubmitError(err);
        setDisputeState({ isLoading: false, error: toMsg(err), blockchainError: errInfo });
        throw err;
      } finally {
        setActiveAction(null);
      }
    },
    [address, signAndSubmit]
  );

  const resolveDispute = useCallback(
    async (orderId: string, resolveToBuyer: boolean) => {
      if (!address) throw new Error("Wallet not connected");
      setResolveState({ isLoading: true, error: null, blockchainError: null });
      try {
        const { resolveDispute: buildResolveDispute } = await import("@/services/stellar/contractService");
        const result = await buildResolveDispute(address, orderId, resolveToBuyer);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          const errInfo = classifySubmitError(submitResult.error ?? "Transaction failed");
          setResolveState({ isLoading: false, error: submitResult.error ?? errInfo.message, blockchainError: errInfo });
          throw new Error(submitResult.error ?? errInfo.message);
        }
        setResolveState({ isLoading: false, error: null, blockchainError: null });
        return submitResult;
      } catch (err) {
        const errInfo = classifySubmitError(err);
        setResolveState({ isLoading: false, error: toMsg(err), blockchainError: errInfo });
        throw err;
      }
    },
    [address, signAndSubmit]
  );

  const splitFunds = useCallback(
    async (orderId: string, buyerShare: bigint, farmerShare: bigint) => {
      if (!address) throw new Error("Wallet not connected");
      setSplitState({ isLoading: true, error: null, blockchainError: null });
      try {
        const { splitFunds: buildSplitFunds } = await import("@/services/stellar/contractService");
        const result = await buildSplitFunds(address, orderId, buyerShare, farmerShare);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Failed to build transaction");
        }
        const submitResult = await signAndSubmit(result.data);
        if (!submitResult.success) {
          const errInfo = classifySubmitError(submitResult.error ?? "Transaction failed");
          setSplitState({ isLoading: false, error: submitResult.error ?? errInfo.message, blockchainError: errInfo });
          throw new Error(submitResult.error ?? errInfo.message);
        }
        setSplitState({ isLoading: false, error: null, blockchainError: null });
        return submitResult;
      } catch (err) {
        const errInfo = classifySubmitError(err);
        setSplitState({ isLoading: false, error: toMsg(err), blockchainError: errInfo });
        throw err;
      }
    },
    [address, signAndSubmit]
  );

  const getOrderDetails = useCallback(
    async (orderId: string): Promise<Order | null> => {
      setQueryState({ isLoading: true, error: null, blockchainError: null });
      try {
        const result = await getOrder(orderId);
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Order not found");
        }
        setQueryState({ isLoading: false, error: null, blockchainError: null });
        return result.data;
      } catch (err) {
        const errInfo = classifySubmitError(err);
        setQueryState({ isLoading: false, error: toMsg(err), blockchainError: errInfo });
        return null;
      }
    },
    []
  );

  const clearError = useCallback(() => {
    setConfirmState((s) => ({ ...s, error: null, blockchainError: null }));
    setRefundState((s) => ({ ...s, error: null, blockchainError: null }));
    setDisputeState((s) => ({ ...s, error: null, blockchainError: null }));
  }, []);

  const isLoading = activeAction !== null;
  const unifiedError = confirmState.error ?? refundState.error ?? disputeState.error;
  const unifiedBlockchainError = confirmState.blockchainError ?? refundState.blockchainError ?? disputeState.blockchainError;

  const tx: TransactionApi = {
    isLoading,
    error: unifiedError,
    blockchainError: unifiedBlockchainError,
    activeAction,
    clearError,
    confirm: confirmReceipt,
    refund: requestRefund,
    dispute: openDispute,
  };

  return {
    tx,
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
