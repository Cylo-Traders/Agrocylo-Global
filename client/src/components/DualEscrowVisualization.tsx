"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Text } from "@/components/ui";

type EscrowStage = "idle" | "funded" | "delivered" | "confirmed";

interface DualEscrowVisualizationProps {
  stage: EscrowStage;
  productName: string;
  quantity: string;
  amountLabel: string;
  orderId: string | null;
  createTxHash?: string | null;
  confirmTxHash?: string | null;
  onMarkDelivered: () => void;
  onConfirmReceipt: () => void;
  isDeliveryMarked: boolean;
  isConfirming: boolean;
  canMarkDelivered: boolean;
  canConfirmReceipt: boolean;
}

function statusBadge(complete: boolean, pendingLabel: string, doneLabel: string) {
  return (
    <Badge variant={complete ? "success" : "outline"}>
      {complete ? doneLabel : pendingLabel}
    </Badge>
  );
}

function stateRow(
  label: string,
  detail: string,
  complete: boolean,
  pendingLabel: string,
  doneLabel: string,
) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white/70 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <Text variant="label">{label}</Text>
        {statusBadge(complete, pendingLabel, doneLabel)}
      </div>
      <Text variant="bodySmall" muted>
        {detail}
      </Text>
    </div>
  );
}

export default function DualEscrowVisualization({
  stage,
  productName,
  quantity,
  amountLabel,
  orderId,
  createTxHash,
  confirmTxHash,
  onMarkDelivered,
  onConfirmReceipt,
  isDeliveryMarked,
  isConfirming,
  canMarkDelivered,
  canConfirmReceipt,
}: DualEscrowVisualizationProps) {
  const fundsLocked = stage !== "idle";
  const deliveryShared = stage === "delivered" || stage === "confirmed";
  const receiptConfirmed = stage === "confirmed";
  const paymentReleased = stage === "confirmed";

  return (
    <Card variant="filled" padding="lg" className="border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50">
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Dual Escrow Visualization</CardTitle>
          <Text variant="bodySmall" muted className="mt-1">
            Both sides of the barter flow stay visible: buyer funds lock first, then receipt confirmation releases value to the farmer.
          </Text>
        </div>
        <Badge variant={receiptConfirmed ? "success" : fundsLocked ? "warning" : "outline"}>
          {receiptConfirmed ? "Escrow Settled" : fundsLocked ? "Escrow Active" : "Awaiting Funding"}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-neutral-200 bg-white/80 p-5">
            <div className="mb-4">
              <Text variant="h4" as="h4">
                Buyer Side
              </Text>
              <Text variant="bodySmall" muted>
                {quantity} x {productName}
              </Text>
            </div>
            <div className="space-y-3">
              {stateRow(
                "Funds Locked",
                `Buyer value is locked in escrow for ${amountLabel} until receipt is confirmed.`,
                fundsLocked,
                "Waiting",
                "Locked",
              )}
              {stateRow(
                "Receipt Confirmation",
                "Buyer confirms the goods have arrived and match expectations.",
                receiptConfirmed,
                "Pending",
                "Confirmed",
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white/80 p-5">
            <div className="mb-4">
              <Text variant="h4" as="h4">
                Farmer Side
              </Text>
              <Text variant="bodySmall" muted>
                Delivery and payment release stay tied to buyer confirmation.
              </Text>
            </div>
            <div className="space-y-3">
              {stateRow(
                "Goods Delivered",
                "Farmer-side delivery is represented before the buyer signs the final receipt step.",
                deliveryShared,
                "In Transit",
                "Delivered",
              )}
              {stateRow(
                "Payment Released",
                "Funds leave escrow only after the buyer confirms receipt.",
                paymentReleased,
                "Held",
                "Released",
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white/80 p-5">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <Text variant="h4" as="h4">
                Confirm Receipt Flow
              </Text>
              <Text variant="bodySmall" muted>
                Use the first action to move the farmer side into delivered state, then complete the on-chain buyer confirmation.
              </Text>
            </div>
            {orderId ? <Badge variant="outline">Order #{orderId}</Badge> : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={onMarkDelivered}
              disabled={!canMarkDelivered}
            >
              {isDeliveryMarked ? "Delivery Marked" : "Mark Goods Delivered"}
            </Button>
            <Button
              variant="primary"
              isLoading={isConfirming}
              onClick={onConfirmReceipt}
              disabled={!canConfirmReceipt}
            >
              {receiptConfirmed ? "Receipt Confirmed" : "Confirm Receipt"}
            </Button>
          </div>

          {(createTxHash || confirmTxHash) ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {createTxHash ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <Text variant="label">Funding Tx</Text>
                  <Text variant="caption" className="mt-1 block break-all">
                    {createTxHash}
                  </Text>
                </div>
              ) : null}
              {confirmTxHash ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <Text variant="label">Receipt Tx</Text>
                  <Text variant="caption" className="mt-1 block break-all">
                    {confirmTxHash}
                  </Text>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
