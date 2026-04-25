"use client";

import React, { createContext, useState, useCallback, useMemo } from "react";
import type {
  TransactionFeedback,
  TransactionState,
  TransactionFeedbackContextType,
  TransactionFeedbackProviderProps,
} from "@/types/transaction";

const DEFAULT_FEEDBACK: TransactionFeedback = {
  state: "idle",
};

export const TransactionFeedbackContext = createContext<TransactionFeedbackContextType | null>(
  null
);

export function TransactionFeedbackProvider({ children }: TransactionFeedbackProviderProps) {
  const [feedback, setFeedback] = useState<TransactionFeedback>(DEFAULT_FEEDBACK);

  const initiate = useCallback((message?: string) => {
    setFeedback({
      state: "pending",
      message: message || "Initiating transaction...",
      timestamp: Date.now(),
    });
  }, []);

  const pending = useCallback((message?: string) => {
    setFeedback((prev) => ({
      ...prev,
      state: "pending",
      message: message,
      timestamp: Date.now(),
    }));
  }, []);

  const confirming = useCallback((message?: string) => {
    setFeedback((prev) => ({
      ...prev,
      state: "confirming",
      message: message || "Awaiting blockchain confirmation...",
      timestamp: Date.now(),
    }));
  }, []);

  const success = useCallback((txHash: string) => {
    setFeedback({
      state: "success",
      txHash,
      message: "Transaction confirmed successfully",
      timestamp: Date.now(),
    });
  }, []);

  const failure = useCallback((error: string) => {
    setFeedback({
      state: "failure",
      errorMessage: error,
      message: "Transaction failed",
      timestamp: Date.now(),
    });
  }, []);

  const reset = useCallback(() => {
    setFeedback(DEFAULT_FEEDBACK);
  }, []);

  const isLoading = feedback.state === "pending" || feedback.state === "confirming";
  const isTerminal = feedback.state === "success" || feedback.state === "failure";

  const value: TransactionFeedbackContextType = useMemo(
    () => ({
      feedback,
      initiate,
      pending,
      confirming,
      success,
      failure,
      reset,
      isLoading,
      isTerminal,
    }),
    [feedback, initiate, pending, confirming, success, failure, reset, isLoading, isTerminal]
  );

  return (
    <TransactionFeedbackContext.Provider value={value}>
      {children}
    </TransactionFeedbackContext.Provider>
  );
}
