import { toast } from "sonner";
import type { OrderEventNotification } from "./api";

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

function getOrderEventTitle(type: string): string {
  switch (type) {
    case "created":
      return "Order Funded";
    case "confirmed":
      return "Delivery Confirmed";
    case "refunded":
      return "Refund Issued";
    default:
      return "Order Update";
  }
}

export function showOrderEventToast(
  notification: OrderEventNotification,
  onOpenOrder?: (orderId: string) => void,
): void {
  const title = getOrderEventTitle(notification.type);
  const action =
    notification.orderId && onOpenOrder
      ? {
          label: "View order",
          onClick: () => onOpenOrder(notification.orderId!),
        }
      : undefined;

  const toastOptions = {
    id: `order-event-${notification.id}`,
    description: notification.message,
    duration: 10000,
    action,
  };

  switch (notification.type) {
    case "created":
    case "confirmed":
      toast.success(title, toastOptions);
      break;
    case "refunded":
      toast.info(title, toastOptions);
      break;
    default:
      toast(title, toastOptions);
      break;
  }
}
