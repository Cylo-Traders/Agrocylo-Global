"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ShieldAlert } from "lucide-react";
import CountdownTimer from "@/components/orders/CountdownTimer";
import MilestoneEscrowProgress from "@/components/MilestoneEscrowProgress";
import ProvenanceViewer from "@/components/ProvenanceViewer";
import type { ProvenanceRecord } from "@/types/provenance";
import { AddressBlock, Metric, TxRow } from "./OrderDetailsComponents";

interface OrderInfoSectionProps {
  order: {
    buyer: string | null;
    seller: string | null;
    amount: string;
    createdAt: number;
    status: string;
    orderId: string;
  };
  totalXlm: string;
  createdAtLabel: string;
  isPending: boolean;
  confirmTxHash: string | null;
  refundTxHash: string | null;
  milestoneIndex: number;
  isFarmer: boolean;
  onAdvanceMilestone: () => void;
  advancingMilestone: boolean;
  provenance: ProvenanceRecord | null;
  provenanceLoading: boolean;
}

export function OrderInfoSection({
  order,
  totalXlm,
  createdAtLabel,
  isPending,
  confirmTxHash,
  refundTxHash,
  milestoneIndex,
  isFarmer,
  onAdvanceMilestone,
  advancingMilestone,
  provenance,
  provenanceLoading,
}: OrderInfoSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parties</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <AddressBlock label="Buyer" address={order.buyer} />
          <AddressBlock label="Farmer" address={order.seller} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Escrow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric
              label="Amount locked"
              value={`${totalXlm} XLM`}
              highlight
            />
            <Metric label="Created" value={createdAtLabel} />
            <Metric
              label="Expiry"
              value={
                isPending ? (
                  <CountdownTimer createdAt={order.createdAt} />
                ) : (
                  "—"
                )
              }
            />
          </div>

          {(confirmTxHash || refundTxHash) && (
            <>
              <Separator />
              <div className="grid gap-3 text-xs">
                {confirmTxHash && (
                  <TxRow label="Confirm tx" hash={confirmTxHash} />
                )}
                {refundTxHash && (
                  <TxRow label="Refund tx" hash={refundTxHash} />
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {order.status === "Disputed" && (
        <Card className="border-destructive/30">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldAlert className="text-destructive mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">Dispute opened</p>
              <p className="text-muted-foreground mt-1 text-sm">
                An admin is reviewing this dispute and will resolve it via
                Refund, Release, or Split.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <MilestoneEscrowProgress
        currentMilestoneIndex={milestoneIndex}
        canAdvance={isFarmer && order.status === "Pending"}
        onAdvance={onAdvanceMilestone}
        isAdvancing={advancingMilestone}
      />

      <ProvenanceViewer
        record={provenance}
        isLoading={provenanceLoading}
      />
    </div>
  );
}
