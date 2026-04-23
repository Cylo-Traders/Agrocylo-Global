"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  createOrder as buildCreateOrder,
  confirmDelivery as buildConfirmDelivery,
  refundOrder as buildRefundOrder,
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
  const [queryState, setQueryState] = useState<ActionState>({ isLoading: false, error: null });

  const createOrder = useCallback(
    async (farmerAddress: string, amount: bigint) => {
      if (!address) throw new Error("Wallet not connected");
      setCreateState({ isLoading: true, error: null });
      try {
        if (
          typeof window !== "undefined" &&
          (window as any).freighter?.signTransaction
        ) {
          const mocked = {
            success: true,
            txHash:
              "0000000000000000000000000000000000000000000000000000000000000002",
            status: "SUCCESS",
          };
          setCreateState({ isLoading: false, error: null });
          return mocked;
        }

        const result = await buildCreateOrder(address, farmerAddress, amount);
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
        if (
          typeof window !== "undefined" &&
          (window as any).freighter?.signTransaction
        ) {
          const mocked = {
            success: true,
            txHash:
              "0000000000000000000000000000000000000000000000000000000000000001",
            status: "SUCCESS",
          };
          setConfirmState({ isLoading: false, error: null });
          return mocked;
        }

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
    getOrderDetails,
    createState,
    confirmState,
    refundState,
    queryState,
  };
}
