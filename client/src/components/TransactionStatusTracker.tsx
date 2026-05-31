"use client";

import {
  Banknote,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCcw,
  Undo2,
  Wifi,
  WifiOff,
  ShieldAlert,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import CopyButton from "@/components/shared/copy-button";
import { formatTruncatedAddress } from "@/lib/helpers/format-address";
import { cn } from "@/lib/utils";
import { useTransactionStatusTracker } from "@/hooks/useTransactionStatusTracker";
import { useSocket } from "@/hooks/useSocket";
import type { Order } from "@/services/stellar/contractService";

export type EscrowStatus = "pending" | "funded" | "delivered" | "refunded" | "disputed";

export interface TransactionStatusTrackerProps {
  orderId: string;
  initialStatus?: EscrowStatus;
  onStatusChange?: (status: EscrowStatus, order: Order) => void;
  pollInterval?: number;
  className?: string;
  /** Stellar network for block explorer links (default: testnet) */
  network?: "testnet" | "mainnet";
}

interface StatusConfig {
  label: string;
  description: string;
  badge: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
  Icon: typeof Clock;
  /** Estimated minutes to next status transition */
  estimatedMinutes: number | null;
}

const statusConfig: Record<EscrowStatus, StatusConfig> = {
  pending: {
    label: "Pending",
    description: "Transaction is waiting for funding.",
    badge: "warning",
    Icon: Clock,
    estimatedMinutes: 5,
  },
  funded: {
    label: "Funded",
    description: "Escrow has been funded successfully.",
    badge: "default",
    Icon: Banknote,
    estimatedMinutes: 60,
  },
  delivered: {
    label: "Delivered",
    description: "Goods have been delivered and confirmed.",
    badge: "success",
    Icon: CheckCircle2,
    estimatedMinutes: null,
  },
  refunded: {
    label: "Refunded",
    description: "Funds have been returned to the buyer.",
    badge: "destructive",
    Icon: Undo2,
    estimatedMinutes: null,
  },
  disputed: {
    label: "Disputed",
    description: "A dispute is active. Funds are held until resolved.",
    badge: "destructive",
    Icon: ShieldAlert,
    estimatedMinutes: null,
  },
};

const ORDER = ["pending", "funded", "delivered", "refunded", "disputed"] as const;

const EXPLORER_BASE: Record<"testnet" | "mainnet", string> = {
  testnet: "https://stellar.expert/explorer/testnet/tx",
  mainnet: "https://stellar.expert/explorer/public/tx",
};

export function TransactionStatusTracker({
  orderId,
  initialStatus,
  onStatusChange,
  pollInterval,
  className,
  network = "testnet",
}: TransactionStatusTrackerProps) {
  const {
    status,
    order,
    isLoading,
    error,
    lastUpdated,
    confirmationCount,
    refresh,
  } = useTransactionStatusTracker({
    orderId,
    initialStatus,
    pollInterval,
    autoStart: true,
  });

  const { isConnected: wsConnected } = useSocket();

  const currentIdx = ORDER.indexOf(status);
  const current = statusConfig[status];
  const progressPct = Math.round(((currentIdx + 1) / ORDER.length) * 100);

  // Notify parent when status changes
  const prevStatus = order ? status : null;
  if (prevStatus && onStatusChange && order) {
    // Fired inside event handlers via useTransactionStatusTracker
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Transaction Status</CardTitle>
          <div className="flex items-center gap-2">
            {/* Real-time connection indicator */}
            <span
              title={wsConnected ? "Real-time updates active" : "Polling for updates"}
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                wsConnected ? "text-green-500" : "text-muted-foreground",
              )}
            >
              {wsConnected ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
            </span>
            <Badge variant={current.badge} className="gap-1.5">
              <current.Icon className="size-3.5" />
              {current.label}
            </Badge>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">{current.description}</p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Overall progress bar */}
        <div className="space-y-1.5">
          <div className="text-muted-foreground flex justify-between text-xs">
            <span>Progress</span>
            <span>{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        {/* Status timeline */}
        <div className="flex items-center gap-1">
          {ORDER.map((s, i) => {
            const cfg = statusConfig[s];
            const isActive = i === currentIdx;
            const isPast = i < currentIdx;
            return (
              <div key={s} className="flex flex-1 items-center gap-1">
                <div
                  className={cn(
                    "grid size-8 shrink-0 place-content-center rounded-full text-xs transition-colors",
                    isActive && "bg-primary text-primary-foreground",
                    isPast && "bg-primary/30 text-primary",
                    !isActive && !isPast && "bg-muted text-muted-foreground",
                  )}
                >
                  <cfg.Icon className="size-4" />
                </div>
                {i < ORDER.length - 1 && (
                  <div
                    className={cn(
                      "h-px flex-1",
                      isPast || isActive ? "bg-primary/40" : "bg-border",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="text-muted-foreground grid grid-cols-4 text-center text-[10px]">
          {ORDER.map((s) => (
            <span key={s}>{statusConfig[s].label}</span>
          ))}
        </div>

        {/* Estimated time + confirmations */}
        <div className="flex items-center justify-between text-xs">
          {current.estimatedMinutes !== null ? (
            <span className="text-muted-foreground">
              Est. ~{current.estimatedMinutes} min to next step
            </span>
          ) : (
            <span className="text-muted-foreground">No further steps</span>
          )}
          {confirmationCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {confirmationCount} update{confirmationCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Order details */}
        {order && (
          <>
            <Separator />
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <KV label="Order ID" value={order.orderId} mono />
              <KV
                label="Amount"
                value={`${(Number(order.amount) / 10_000_000).toFixed(2)} XLM`}
                bold
              />
              <KV
                label="Buyer"
                value={formatTruncatedAddress(order.buyer)}
                mono
                copyValue={order.buyer}
              />
              <KV
                label="Seller"
                value={formatTruncatedAddress(order.seller)}
                mono
                copyValue={order.seller}
              />
              <KV
                label="Created"
                value={new Date(order.createdAt * 1000).toLocaleString()}
              />
              {/* Block explorer link */}
              {order.orderId && (
                <div>
                  <p className="text-muted-foreground text-xs">Explorer</p>
                  <a
                    href={`${EXPLORER_BASE[network]}/${order.orderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary mt-0.5 flex items-center gap-1 text-xs hover:underline"
                  >
                    View on Stellar Expert
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border p-3 text-sm">
            {error}
          </div>
        )}

        {/* Footer */}
        <Separator />
        <div className="flex items-center justify-between text-xs">
          <div className="text-muted-foreground flex items-center gap-2">
            {isLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span className="bg-primary size-1.5 rounded-full" />
            )}
            Last updated {lastUpdated.toLocaleTimeString()}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isLoading}
          >
            <RefreshCcw className={cn("size-3.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function KV({
  label,
  value,
  mono,
  bold,
  copyValue,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  copyValue?: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="mt-0.5 flex items-center gap-2">
        <span
          className={cn(
            "truncate text-sm",
            mono && "font-mono text-xs",
            bold && "font-semibold",
          )}
        >
          {value}
        </span>
        {copyValue && (
          <CopyButton
            text={copyValue}
            className="text-muted-foreground hover:text-foreground inline-flex items-center"
            iconClassName="!size-3"
          />
        )}
      </div>
    </div>
  );
}

export default TransactionStatusTracker;
