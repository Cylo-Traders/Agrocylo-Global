"use client";

import { useState, useCallback, useEffect } from "react";
import { signAndSubmitTransaction } from "@/lib/signTransaction";
import { classifyError, logErrorWithContext } from "@/lib/errorHandling";
import { getInFlightForIntent } from "@/lib/pendingTransactions";
import { reconcilePendingTransactions } from "@/lib/transactionRecovery";

export type TxStatus =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "success"
  | "pending"
  | "error";

export interface TxState {
  status: TxStatus;
  txHash?: string;
  error?: string;
}

export interface UseTransactionReturn extends TxState {
  execute: (
    buildXdr: () => Promise<string>,
    options?: {
      intent?: string;
      onSubmitted?: (txHash: string) => Promise<void>;
    },
  ) => Promise<void>;
  reset: () => void;
  isIdle: boolean;
  isPending: boolean;
  isBusy: boolean;
  /** Submitted but not yet confirmed — the caller must NOT resubmit. */
  isUnconfirmed: boolean;
  isSuccess: boolean;
  isError: boolean;
}

const INITIAL_STATE: TxState = { status: "idle" };
const LAST_INTENT_KEY = "agro:last-tx-intent";

function readLastIntent(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_INTENT_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLastIntent(intent: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_INTENT_KEY, intent);
  } catch {
  }
}

function initialTxState(): TxState {
  const intent = readLastIntent();
  const inFlight = intent ? getInFlightForIntent(intent) : null;
  if (inFlight) {
    return {
      status: "pending",
      txHash: inFlight.hash,
      error: "Transaction submitted earlier is still being confirmed.",
    };
  }
  return INITIAL_STATE;
}

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
  const [state, setState] = useState<TxState>(initialTxState);

  useEffect(() => {
    let active = true;
    const intent = readLastIntent();
    if (!intent || !getInFlightForIntent(intent)) return;

    void reconcilePendingTransactions()
      .then((resolved) => {
        if (!active) return;
        const match = resolved.find((tx) => tx.intent === intent);
        if (match?.status === "confirmed") {
          setState({ status: "success", txHash: match.hash });
        } else if (match) {
          setState({
            status: "error",
            txHash: match.hash,
            error: "The earlier transaction did not confirm on-chain. Please review before retrying.",
          });
        } else {
          const stillPending = intent ? getInFlightForIntent(intent) : null;
          if (stillPending) setState({ status: "pending", txHash: stillPending.hash });
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const execute = useCallback(async (
    buildXdr: () => Promise<string>,
    options?: {
      intent?: string;
      onSubmitted?: (txHash: string) => Promise<void>;
    },
  ) => {
    if (options?.intent) {
      const inFlight = getInFlightForIntent(options.intent);
      if (inFlight) {
        setState({
          status: "pending",
          txHash: inFlight.hash,
          error: "A transaction for this action is already in progress.",
        });
        return;
      }
      writeLastIntent(options.intent);
    }
    setState({ status: "building" });
    try {
      const xdr = await buildXdr();

      setState({ status: "signing" });
      setState({ status: "submitting" });

      const result = await signAndSubmitTransaction(xdr, undefined, {
        intent: options?.intent,
        onSubmitted: options?.onSubmitted,
      });

      if (result.success) {
        setState({ status: "success", txHash: result.txHash });
      } else if (result.outcome === "pending") {
        // Submitted, not confirmed, not failed. Surface it as pending so the UI
        // never tells the user to retry (which would double-order / double-pay).
        setState({
          status: "pending",
          txHash: result.txHash,
          error: result.error,
        });
      } else {
        const classified = classifyError(result.error, "submitOrderTransaction");
        logErrorWithContext(result.error ?? "transaction failed", {
          feature: "useTransaction",
          action: "execute",
          step: "submit",
          txHash: result.txHash,
          status: result.status,
          category: classified.category,
        });
        setState({ status: "error", error: classified.actionableMessage });
      }
    } catch (err) {
      const classified = classifyError(err, "submitOrderTransaction");
      logErrorWithContext(err, {
        feature: "useTransaction",
        action: "execute",
        step: "buildOrSubmit",
        category: classified.category,
      });
      setState({
        status: "error",
        error: classified.actionableMessage,
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
      state.status === "submitting" ||
      state.status === "pending",
    isBusy:
      state.status === "building" ||
      state.status === "signing" ||
      state.status === "submitting" ||
      state.status === "pending",
    isUnconfirmed: state.status === "pending",
    isSuccess: state.status === "success",
    isError: state.status === "error",
  };
}
