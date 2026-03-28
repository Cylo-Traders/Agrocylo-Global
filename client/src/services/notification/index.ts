import { toast } from "sonner";

export type NotificationType = "success" | "error" | "info" | "loading";

export interface TransactionToastOptions {
  txHash?: string;
}

export function notifyTransactionSubmitted(_txHash?: string): void {
  toast.loading("Transaction submitted...", {
    id: "tx-submitted",
    duration: Infinity,
  });
}

export function notifyTransactionConfirmed(txHash?: string): void {
  toast.success("Transaction confirmed!", {
    id: "tx-submitted",
    description: txHash ? `Tx: ${txHash.slice(0, 8)}...${txHash.slice(-4)}` : undefined,
    duration: 5000,
  });
}

export function notifyTransactionFailed(error: string): void {
  toast.error("Transaction failed", {
    id: "tx-submitted",
    description: error,
    duration: 8000,
  });
}

export function notifyTransactionConfirming(): void {
  toast.loading("Awaiting confirmation in wallet...", {
    id: "tx-submitted",
    duration: Infinity,
  });
}

export function dismissNotification(): void {
  toast.dismiss("tx-submitted");
}
