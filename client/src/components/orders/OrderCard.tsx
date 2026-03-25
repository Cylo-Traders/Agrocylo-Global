"use client";

import type { Order } from "@/services/stellar/contractService";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import CountdownTimer from "./CountdownTimer";

interface OrderCardProps {
  order: Order;
  isBuyer: boolean;
  onConfirm?: (orderId: string) => void;
  isConfirming?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-secondary-100 text-secondary-800",
  Completed: "bg-primary-100 text-primary-800",
  Refunded: "bg-red-100 text-red-800",
};

function formatAmount(stroops: bigint): string {
  return (Number(stroops) / 1e7).toFixed(2);
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function OrderCard({
  order,
  isBuyer,
  onConfirm,
  isConfirming,
}: OrderCardProps) {
  const fee = (Number(order.amount) * 3) / 100;
  const net = Number(order.amount) - fee;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm text-neutral-500">
            {isBuyer ? "Farmer" : "Buyer"}
          </p>
          <p className="font-mono text-sm font-medium text-foreground">
            {truncateAddress(isBuyer ? order.seller : order.buyer)}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            STATUS_COLORS[order.status] ?? "bg-neutral-100 text-neutral-700"
          }`}
        >
          {order.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
        <div>
          <p className="text-neutral-500">Total</p>
          <p className="font-semibold text-foreground">
            {formatAmount(order.amount)} XLM
          </p>
        </div>
        <div>
          <p className="text-neutral-500">{isBuyer ? "Fee (3%)" : "You receive"}</p>
          <p className="font-semibold text-foreground">
            {isBuyer
              ? `${(fee / 1e7).toFixed(2)} XLM`
              : `${(net / 1e7).toFixed(2)} XLM`}
          </p>
        </div>
      </div>

      {order.status === "Pending" && (
        <div className="flex items-center justify-between">
          <CountdownTimer createdAt={order.createdAt} />
          {isBuyer && onConfirm && (
            <Button
              variant="primary"
              size="sm"
              isLoading={isConfirming}
              onClick={() => onConfirm(order.orderId)}
            >
              Confirm Receipt
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
