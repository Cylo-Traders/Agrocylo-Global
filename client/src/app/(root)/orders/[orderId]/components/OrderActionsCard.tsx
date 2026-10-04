"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2,
  ShieldAlert,
  Wallet,
  RefreshCcw,
  Clock,
} from "lucide-react";

interface OrderActionsCardProps {
  connected: boolean;
  isBuyer: boolean;
  isFarmer: boolean;
  isPending: boolean;
  canConfirm: boolean;
  canRefund: boolean;
  canDispute: boolean;
  status: string;
  onConfirm: () => void;
  onRefund: () => void;
  onOpenDispute: () => void;
  confirmLoading: boolean;
  refundLoading: boolean;
  actionError: string | null;
  confirmStateError: string | null;
  refundStateError: string | null;
  expiryHours: number;
}

export function OrderActionsCard({
  connected,
  isBuyer,
  isFarmer,
  isPending,
  canConfirm,
  canRefund,
  canDispute,
  status,
  onConfirm,
  onRefund,
  onOpenDispute,
  confirmLoading,
  refundLoading,
  actionError,
  confirmStateError,
  refundStateError,
  expiryHours,
}: OrderActionsCardProps) {
  return (
    <div className="space-y-4 md:sticky md:top-32 md:self-start">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!connected ? (
            <div className="bg-secondary/50 flex items-start gap-2 rounded-lg p-3 text-sm">
              <Wallet className="mt-0.5 size-4 shrink-0" />
              <span>Connect your wallet to act on this order.</span>
            </div>
          ) : !isBuyer && !isFarmer ? (
            <p className="text-muted-foreground text-sm">
              You&apos;re not a party on this order, so no actions are
              available.
            </p>
          ) : (
            <>
              {canConfirm && (
                <Button
                  onClick={() => void onConfirm()}
                  isLoading={confirmLoading}
                  className="w-full"
                >
                  <CheckCircle2 className="size-4" />
                  Confirm Receipt
                </Button>
              )}

              {canRefund && (
                <Button
                  variant="destructive"
                  onClick={() => void onRefund()}
                  isLoading={refundLoading}
                  className="w-full"
                >
                  <RefreshCcw className="size-4" />
                  Refund (Expired)
                </Button>
              )}

              {canDispute && (
                <Button
                  variant="outline"
                  onClick={onOpenDispute}
                  className="w-full"
                >
                  <ShieldAlert className="size-4" />
                  Open Dispute
                </Button>
              )}

              {!isPending && (
                <p className="text-muted-foreground text-sm">
                  This order is{" "}
                  <span className="font-medium">{status}</span>. No
                  further on-chain actions are available.
                </p>
              )}

              {actionError && (
                <p className="text-destructive text-xs" role="alert">
                  {actionError}
                </p>
              )}
              {!actionError && confirmStateError && (
                <p className="text-destructive text-xs">
                  {confirmStateError}
                </p>
              )}
              {!actionError && refundStateError && (
                <p className="text-destructive text-xs">
                  {refundStateError}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 py-4 text-xs">
          <p className="text-muted-foreground flex items-center gap-1.5">
            <Clock className="size-3.5" />
            Orders expire {expiryHours}h after creation. If not confirmed,
            buyers can refund the escrow.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
