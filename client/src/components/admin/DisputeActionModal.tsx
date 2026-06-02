"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  Gavel,
  Scale,
  Undo2,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { useEscrowContract } from "@/hooks/useEscrowContract";

type ResolutionType = "refund" | "release" | "split";

interface Dispute {
  id?: string;
  orderIdOnChain?: string;
  reason?: string;
  evidenceHash?: string;
  order?: { amount?: string; orderIdOnChain?: string };
  [k: string]: unknown;
}

interface DisputeActionModalProps {
  dispute: Dispute;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DisputeActionModal({
  dispute,
  onClose,
  onSuccess,
}: DisputeActionModalProps) {
  const { resolveDispute, splitFunds, resolveState, splitState } =
    useEscrowContract();

  const [resolutionType, setResolutionType] = useState<ResolutionType>("refund");
  const [buyerPct, setBuyerPct] = useState(50);
  const [error, setError] = useState<string | null>(null);

  const totalStroops = BigInt(dispute.order?.amount ?? "0");
  const totalXlm = Number(totalStroops) / 1e7;
  const orderIdOnChain =
    dispute.orderIdOnChain ?? dispute.order?.orderIdOnChain ?? "";

  const buyerStroops = useMemo(
    () => (totalStroops * BigInt(buyerPct)) / BigInt(100),
    [totalStroops, buyerPct],
  );
  const farmerStroops = totalStroops - buyerStroops;

  const isLoading = resolveState.isLoading || splitState.isLoading;

  async function handleResolve() {
    setError(null);
    try {
      if (resolutionType === "refund") {
        await resolveDispute(orderIdOnChain, true);
      } else if (resolutionType === "release") {
        await resolveDispute(orderIdOnChain, false);
      } else {
        await splitFunds(orderIdOnChain, buyerStroops, farmerStroops);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolution failed");
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isLoading) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="text-primary size-5" />
            Resolve Dispute
          </DialogTitle>
          <DialogDescription>
            Order #{orderIdOnChain} · {totalXlm.toFixed(2)} XLM in escrow
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Info label="Reason">
            <p className="text-sm">{dispute.reason || "No reason provided."}</p>
          </Info>

          {dispute.evidenceHash && (
            <Info label="Evidence">
              <p className="font-mono mt-1 text-xs break-all">
                {dispute.evidenceHash}
              </p>
              <a
                href={`https://ipfs.io/ipfs/${dispute.evidenceHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 mt-2 inline-flex items-center gap-1 text-xs font-medium"
              >
                View on IPFS
                <ExternalLink className="size-3" />
              </a>
            </Info>
          )}
        </div>

        <Tabs
          value={resolutionType}
          onValueChange={(v) => setResolutionType(v as ResolutionType)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="refund" className="flex-1 gap-1.5">
              <Undo2 className="size-3.5" />
              Refund Buyer
            </TabsTrigger>
            <TabsTrigger value="release" className="flex-1 gap-1.5">
              <ArrowRight className="size-3.5" />
              Release to Farmer
            </TabsTrigger>
            <TabsTrigger value="split" className="flex-1 gap-1.5">
              <Scale className="size-3.5" />
              Split
            </TabsTrigger>
          </TabsList>

          <TabsContent value="refund" className="mt-4">
            <p className="text-muted-foreground text-sm">
              Return the full <strong>{totalXlm.toFixed(2)} XLM</strong> to the
              buyer. The farmer receives nothing.
            </p>
          </TabsContent>

          <TabsContent value="release" className="mt-4">
            <p className="text-muted-foreground text-sm">
              Release the full <strong>{totalXlm.toFixed(2)} XLM</strong>{" "}
              (minus the 3% platform fee) to the farmer. The buyer&apos;s
              dispute is rejected.
            </p>
          </TabsContent>

          <TabsContent value="split" className="mt-4 space-y-5">
            <p className="text-muted-foreground text-sm">
              Split the escrowed amount between buyer and farmer.
            </p>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Buyer share</span>
                <span className="text-primary font-mono">{buyerPct}%</span>
              </div>
              <Slider
                value={[buyerPct]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => setBuyerPct(v)}
              />
              <div className="text-muted-foreground flex items-center justify-between text-xs">
                <span>Farmer: {100 - buyerPct}%</span>
              </div>
            </div>

            <div className="bg-secondary/40 grid grid-cols-1 gap-3 rounded-2xl border p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs">Buyer receives</p>
                <p className="mt-0.5 font-semibold">
                  {(Number(buyerStroops) / 1e7).toFixed(2)} XLM
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Farmer receives</p>
                <p className="mt-0.5 font-semibold">
                  {(Number(farmerStroops) / 1e7).toFixed(2)} XLM
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border p-3 text-sm">
            {error}
          </div>
        )}

        <Separator />

        <DialogFooter className="flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleResolve()}
            isLoading={isLoading}
            disabled={isLoading}
          >
            Confirm Resolution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-secondary/40 rounded-xl border p-3">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
