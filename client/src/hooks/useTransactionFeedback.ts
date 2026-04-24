"use client";

import { useContext } from "react";
import { TransactionFeedbackContext } from "@/context/TransactionFeedbackContext";
import type { UseTransactionFeedbackResult } from "@/types/transaction";

/**
 * Hook to access transaction feedback context and utilities.
 * Must be used within a TransactionFeedbackProvider.
 *
 * @example
 * const { success, failure, pending, confirming, executeTransaction } = useTransactionFeedback();
 *
 * // Manual state management
 * try {
 *   pending("Building transaction...");
 *   const result = await buildTx();
 *   confirming("Awaiting signature...");
 *   const signed = await signTx(result);
 *   success(signed.txHash);
 * } catch (err) {
 *   failure(err.message);
 * }
 *
 * // Or use executeTransaction for convenience
 * const result = await executeTransaction(async () => {
 *   const signed = await signAndSubmitTx();
 *   return { txHash: signed.txHash };
 * });
 */
export function useTransactionFeedback(): UseTransactionFeedbackResult {
  const context = useContext(TransactionFeedbackContext);

  if (!context) {
    throw new Error(
      "useTransactionFeedback must be used within a TransactionFeedbackProvider"
    );
  }

  /**
   * Execute an async transaction function with automatic state management.
   * Handles pending → confirming → success/failure flow.
   *
   * @param fn - Async function that returns transaction hash on success
   * @returns Result with success status, txHash, or error message
   */
  const executeTransaction = async (
    fn: () => Promise<{ txHash: string }>
  ) => {
    try {
      context.pending("Processing transaction...");
      const result = await fn();

      if (!result?.txHash) {
        throw new Error("Transaction completed but no hash returned");
      }

      context.confirming("Confirming on blockchain...");
      // Give a moment for confirmation state to register
      await new Promise((r) => setTimeout(r, 500));

      context.success(result.txHash);
      return {
        success: true,
        txHash: result.txHash,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      context.failure(errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  };

  return {
    ...context,
    executeTransaction,
  };
}
