"use client";

import React, { useState } from "react";
import { 
  Button, 
  Text, 
  Input, 
  Card, 
  CardContent, 
  Badge 
} from "@/components/ui";
import { useEscrowContract } from "@/hooks/useEscrowContract";

interface DisputeActionModalProps {
  dispute: any;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DisputeActionModal({ dispute, onClose, onSuccess }: DisputeActionModalProps) {
  const { resolveDispute, splitFunds, resolveState, splitState } = useEscrowContract();
  const [resolutionType, setResolutionType] = useState<"refund" | "release" | "split">("refund");
  const [buyerShare, setBuyerShare] = useState<string>("0");
  const [farmerShare, setFarmerShare] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);

  const totalAmount = BigInt(dispute.order?.amount || "0");
  const orderIdOnChain = dispute.orderIdOnChain || dispute.order?.orderIdOnChain;

  const handleResolve = async () => {
    setError(null);
    try {
      if (resolutionType === "refund") {
        await resolveDispute(orderIdOnChain, true);
      } else if (resolutionType === "release") {
        await resolveDispute(orderIdOnChain, false);
      } else if (resolutionType === "split") {
        const buyerBig = BigInt(Math.floor(parseFloat(buyerShare) * 10_000_000));
        const farmerBig = BigInt(Math.floor(parseFloat(farmerShare) * 10_000_000));
        
        // Sum check (roughly, since totalAmount is also base units)
        // Note: The conversion here should match the contract's base units (likely 7 decimal places for XLM-like assets)
        await splitFunds(orderIdOnChain, buyerBig, farmerBig);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolution failed");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card variant="elevated" className="w-full max-w-lg">
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-4">
            <Text variant="h3" className="font-bold">Resolve Dispute</Text>
            <Button variant="outline" size="sm" onClick={onClose}>×</Button>
          </div>

          <div className="space-y-4 mb-6">
            <div className="bg-muted/30 p-3 rounded-lg">
              <Text variant="body" muted className="text-xs uppercase font-semibold">Reason</Text>
              <Text variant="body" className="mt-1">{dispute.reason}</Text>
            </div>

            {dispute.evidenceHash && (
              <div className="bg-muted/30 p-3 rounded-lg">
                <Text variant="body" muted className="text-xs uppercase font-semibold">Evidence Hash</Text>
                <Text variant="body" className="font-mono text-xs mt-1 break-all">{dispute.evidenceHash}</Text>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2 text-xs" 
                  onClick={() => window.open(`https://ipfs.io/ipfs/${dispute.evidenceHash}`, "_blank")}
                >
                  View on IPFS
                </Button>
              </div>
            )}

            <div>
              <Text variant="body" muted className="text-xs uppercase font-semibold mb-2">Resolution Type</Text>
              <div className="flex gap-2">
                <Button 
                  variant={resolutionType === "refund" ? "primary" : "outline"} 
                  size="sm" 
                  onClick={() => setResolutionType("refund")}
                >
                  Refund Buyer
                </Button>
                <Button 
                  variant={resolutionType === "release" ? "primary" : "outline"} 
                  size="sm" 
                  onClick={() => setResolutionType("release")}
                >
                  Release to Farmer
                </Button>
                <Button 
                  variant={resolutionType === "split" ? "primary" : "outline"} 
                  size="sm" 
                  onClick={() => setResolutionType("split")}
                >
                  Split Funds
                </Button>
              </div>
            </div>

            {resolutionType === "split" && (
              <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                <Input 
                  label="Buyer Share" 
                  type="number" 
                  value={buyerShare} 
                  onChange={(e) => setBuyerShare(e.target.value)} 
                />
                <Input 
                  label="Farmer Share" 
                  type="number" 
                  value={farmerShare} 
                  onChange={(e) => setFarmerShare(e.target.value)} 
                />
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button 
              variant="primary" 
              className="flex-1" 
              onClick={handleResolve}
              isLoading={resolveState.isLoading || splitState.isLoading}
            >
              Confirm Resolution
            </Button>
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
