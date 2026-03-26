"use client";

import type { BuyerOrder } from "@/services/ordersService";
import { Button } from "@/components/ui/Button";

interface OrderCardProps {
  order: BuyerOrder;
  onConfirm?: (orderId: string) => void;
  isConfirming?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-secondary-100 text-secondary-800",
  COMPLETED: "bg-primary-100 text-primary-800",
  REFUNDED: "bg-red-100 text-red-800",
};

function formatAmount(value: string): string {
  const stroops = Number(value);
  if (!Number.isFinite(stroops)) return value;
  return (stroops / 1e7).toFixed(2);
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatStatus(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function OrderCard({ order, onConfirm, isConfirming }: OrderCardProps) {
  const fee = (Number(order.amount) * 3) / 100;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm text-neutral-500">Farmer</p>
          <p className="font-mono text-sm font-medium text-foreground">
            {order.seller_name?.trim() || truncateAddress(order.seller_address)}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            STATUS_COLORS[order.status] ?? "bg-neutral-100 text-neutral-700"
          }`}
        >
          {formatStatus(order.status)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        <div>
          <p className="text-neutral-500">Order</p>
          <p className="font-semibold text-foreground">#{order.order_id}</p>
        </div>
        <div>
          <p className="text-neutral-500">Created</p>
          <p className="font-semibold text-foreground">{formatDate(order.created_at)}</p>
        </div>
        <div>
          <p className="text-neutral-500">Product</p>
          <p className="font-semibold text-foreground">
            {order.product?.name ?? "Indexed order"}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Total Locked</p>
          <p className="font-semibold text-foreground">
            {formatAmount(order.amount)} {order.token}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Platform Fee</p>
          <p className="font-semibold text-foreground">
            {(fee / 1e7).toFixed(2)} {order.token}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Farmer Wallet</p>
          <p className="font-mono text-sm font-semibold text-foreground">
            {truncateAddress(order.seller_address)}
          </p>
        </div>
      </div>

      {order.status === "PENDING" && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-neutral-500">
            Confirm delivery once the order is received.
          </p>
          {onConfirm && (
            <Button
              variant="primary"
              size="sm"
              isLoading={isConfirming}
              onClick={() => onConfirm(order.order_id)}
            >
              Confirm Delivery
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
