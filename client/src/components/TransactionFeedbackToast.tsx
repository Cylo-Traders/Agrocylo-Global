"use client";

import React, { useContext, useEffect } from "react";
import { toast } from "sonner";
import { TransactionFeedbackContext } from "@/context/TransactionFeedbackContext";

export interface TransactionFeedbackToastProps {
  /**
   * Toast ID for tracking
   * @default "tx-feedback"
   */
  toastId?: string;

  /**
   * Auto-dismiss success toast after N milliseconds
   * @default 5000
   */
  successDismissMs?: number;

  /**
   * Auto-dismiss error toast after N milliseconds
   * @default 8000
   */
  errorDismissMs?: number;

  /**
   * Custom block explorer URL builder
   */
  getTxUrl?: (txHash: string) => string;

  /**
   * Show explorer link in toast
   * @default false
   */
  showExplorerLink?: boolean;
}

/**
 * Automatically displays transaction feedback as toast notifications.
 * Renders nothing visually - uses Sonner's toast API.
 *
 * @example
 * <TransactionFeedbackToast
 *   getTxUrl={(hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`}
 *   showExplorerLink
 * />
 */
export function TransactionFeedbackToast({
  toastId = "tx-feedback",
  successDismissMs = 5000,
  errorDismissMs = 8000,
  getTxUrl,
  showExplorerLink = false,
}: TransactionFeedbackToastProps) {
  const context = useContext(TransactionFeedbackContext);

  useEffect(() => {
    if (!context) return;

    const { feedback } = context;
    const { state, txHash, errorMessage, message } = feedback;

    switch (state) {
      case "pending":
        toast.loading(message || "Processing transaction...", {
          id: toastId,
          duration: Infinity,
        });
        break;

      case "confirming":
        toast.loading(message || "Awaiting confirmation...", {
          id: toastId,
          duration: Infinity,
        });
        break;

      case "success":
        const explorerUrl = showExplorerLink && getTxUrl && txHash ? getTxUrl(txHash) : null;
        const description = txHash
          ? `Hash: ${txHash.slice(0, 8)}...${txHash.slice(-4)}`
          : undefined;

        const successToast = (
          <div className="space-y-2">
            {description && <div className="text-sm">{description}</div>}
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-success hover:underline"
              >
                View on Explorer ↗
              </a>
            )}
          </div>
        );

        toast.success(message || "Transaction confirmed!", {
          id: toastId,
          description: description,
          duration: successDismissMs,
        });
        break;

      case "failure":
        toast.error(message || "Transaction failed", {
          id: toastId,
          description: errorMessage || undefined,
          duration: errorDismissMs,
        });
        break;

      case "idle":
        toast.dismiss(toastId);
        break;
    }
  }, [context?.feedback.state, context?.feedback.txHash, context?.feedback.errorMessage]);

  return null;
}
