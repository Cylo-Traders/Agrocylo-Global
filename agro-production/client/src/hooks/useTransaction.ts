"use client";

import { useState, useCallback } from "react";
import { signAndSubmitTransaction } from "@/lib/signTransaction";

export type TxStatus = "idle" | "building" | "signing" | "submitting" | "success" | "error";

export interface TxState {
  status: TxStatus;
  txHash?: string;
  error?: string;
}

export interface UseTransactionReturn extends TxState {
  execute: (buildXdr: () => Promise<string>) => Promise<void>;
  reset: () => void;
  isIdle: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
}

const INITIAL_STATE: TxState = { status: "idle" };

/**
 * Hook that orchestrates the build → sign → submit flow for Soroban
 * transactions. The caller provides a `buildXdr` function that returns
 * the unsigned transaction XDR; this hook handles wallet signing,
 * submission, and status tracking.
 *
 * Usage:
 *   const tx = useTransaction();
 *   await tx.execute(() => buildCreateOrder(buyer, campaignId, amount));
 */
export function useTransaction(): UseTransactionReturn {
  const [state, setState] = useState<TxState>(INITIAL_STATE);

  const execute = useCallback(async (buildXdr: () => Promise<string>) => {
    setState({ status: "building" });
    try {
      const xdr = await buildXdr();

      setState({ status: "signing" });
      setState({ status: "submitting" });

      const result = await signAndSubmitTransaction(xdr);

      if (result.success) {
        setState({ status: "success", txHash: result.txHash });
      } else {
        setState({ status: "error", error: result.error ?? "Transaction failed" });
      }
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const reset = useCallback(() => setState(INITIAL_STATE), []);

  return {
    ...state,
    execute,
    reset,
    isIdle: state.status === "idle",
    isPending:
      state.status === "building" ||
      state.status === "signing" ||
      state.status === "submitting",
    isSuccess: state.status === "success",
    isError: state.status === "error",
  };
}
