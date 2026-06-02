"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import type { Order } from "@/services/stellar/contractService";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatTruncatedAddress } from "@/lib/helpers/format-address";
import CountdownTimer from "./CountdownTimer";

interface OrderCardProps {
  order: Order;
  isBuyer: boolean;
  onConfirm?: (orderId: string) => void;
  isConfirming?: boolean;
}

const PLATFORM_FEE_PCT = 3;
const EXPIRY_HOURS = 96;

/** stroops (1e-7 XLM) → human-readable XLM, 2 decimals. */
function formatAmount(stroops: bigint): string {
  return (Number(stroops) / 1e7).toFixed(2);
}

export default function OrderCard({
  order,
  isBuyer,
  onConfirm,
  isConfirming,
}: OrderCardProps) {
  const counterparty = isBuyer ? order.seller : order.buyer;
  const totalXlm = Number(order.amount) / 1e7;
  const feeXlm = (totalXlm * PLATFORM_FEE_PCT) / 100;
  const netXlm = totalXlm - feeXlm;

  const expirySeconds = order.createdAt + EXPIRY_HOURS * 3600;
  const [isExpired] = useState(
    () => Math.floor(Date.now() / 1000) >= expirySeconds,
  );
  const isPending = order.status === "Pending";

  return (
    <Card className="rounded-xl transition-shadow hover:shadow-md">
      <CardContent className="space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">
              Order #{order.orderId}
            </p>
            <p className="mt-1 text-sm font-medium">
              {isBuyer ? "Farmer" : "Buyer"}:{" "}
              <span className="text-muted-foreground font-mono">
                {formatTruncatedAddress(counterparty)}
              </span>
            </p>
          </div>
          <StatusBadge status={order.status} />
        </header>

        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">
              Locked in escrow
            </p>
            <p className="mt-0.5 font-semibold">
              {formatAmount(order.amount)} XLM
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {isBuyer ? `Platform fee (${PLATFORM_FEE_PCT}%)` : "You receive"}
            </p>
            <p className="mt-0.5 font-semibold">
              {(isBuyer ? feeXlm : netXlm).toFixed(2)} XLM
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
          {isPending ? (
            <CountdownTimer createdAt={order.createdAt} />
          ) : (
            <span className="text-muted-foreground text-xs">
              {new Date(order.createdAt * 1000).toLocaleDateString()}
            </span>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {isPending && isBuyer && onConfirm && !isExpired && (
              <Button
                size="sm"
                isLoading={isConfirming}
                onClick={() => onConfirm(order.orderId)}
              >
                Confirm Receipt
              </Button>
            )}
            {isPending && isExpired && (
              <Button size="sm" variant="destructive" asChild>
                <Link href={`/orders/${order.orderId}`}>
                  <ShieldAlert className="size-3.5" />
                  Refund
                </Link>
              </Button>
            )}
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/orders/${order.orderId}`}>
                View
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
