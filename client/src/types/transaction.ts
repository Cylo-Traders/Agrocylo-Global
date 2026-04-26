/**
 * Transaction feedback types and interfaces
 */

export type TransactionState = "idle" | "pending" | "confirming" | "success" | "failure";

export interface TransactionFeedback {
  state: TransactionState;
  txHash?: string;
  errorMessage?: string;
  message?: string;
  timestamp?: number;
}

export interface TransactionFeedbackContextType {
  feedback: TransactionFeedback;
  initiate: (message?: string) => void;
  pending: (message?: string) => void;
  confirming: (message?: string) => void;
  success: (txHash: string) => void;
  failure: (error: string) => void;
  reset: () => void;
  isLoading: boolean;
  isTerminal: boolean;
}

export interface TransactionFeedbackProviderProps {
  children: React.ReactNode;
}

export interface UseTransactionFeedbackResult extends TransactionFeedbackContextType {
  // Convenience method for sign and submit flow
  executeTransaction: (
    fn: () => Promise<{ txHash: string }>
  ) => Promise<{ success: boolean; txHash?: string; error?: string }>;
}
