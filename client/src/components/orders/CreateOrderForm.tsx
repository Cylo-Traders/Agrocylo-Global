"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useEscrowContract } from "@/hooks/useEscrowContract";
import {
  sanitizeString,
  validateStellarAddress,
  validatePositiveNumber,
} from "@/lib/validation";
import { trackEvent } from "@/lib/analytics";

const PLATFORM_FEE_PCT = 3;

export default function CreateOrderForm() {
  const searchParams = useSearchParams();
  const farmerAddress = searchParams.get("farmer") ?? "";

  const { createOrder, createState } = useEscrowContract();
  const [farmer, setFarmer] = useState(farmerAddress);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [txStep, setTxStep] = useState<"idle" | "signing" | "confirming" | "done" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ farmer?: string; amount?: string }>({});

  const numAmount = parseFloat(amount);
  const isValid = farmer.length > 0 && numAmount > 0;
  const fee = isValid ? (numAmount * PLATFORM_FEE_PCT) / 100 : 0;
  const farmerReceives = isValid ? numAmount - fee : 0;

  function validate(): boolean {
    const next: { farmer?: string; amount?: string } = {};
    const addrError = validateStellarAddress(farmer);
    if (addrError) next.farmer = "Invalid farmer wallet address.";
    const amtError = validatePositiveNumber(amount, "Amount");
    if (amtError) next.amount = amtError;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    try {
      setTxStep("signing");
      const stroops = BigInt(Math.round(numAmount * 1e7));
      const result = await createOrder(sanitizeString(farmer), stroops);

      trackEvent("order_created", {
        amount: numAmount,
      });

      setTxStep("done");
      setTxHash(result?.txHash ?? null);
    } catch {
      setTxStep("error");
    }
  }

  if (txStep === "done") {
    return (
      <Card variant="elevated" padding="lg" className="max-w-lg mx-auto text-center">
        <div className="text-5xl mb-4" aria-hidden="true">✅</div>
        <h2 className="text-xl font-bold text-foreground mb-2">Order Created</h2>
        <p className="text-sm text-muted mb-4">
          Your funds are held in escrow until you confirm delivery.
        </p>
        {txHash && (
          <p className="text-xs font-mono text-neutral-500 break-all mb-4">
            TX: {txHash}
          </p>
        )}
        <Button variant="primary" onClick={() => { setTxStep("idle"); setAmount(""); }}>
          Create Another Order
        </Button>
      </Card>
    );
  }

  return (
    <Card variant="elevated" padding="lg" className="max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-foreground mb-1">Create Order</h2>
      <p className="text-sm text-muted mb-6">
        Funds will be held in escrow until you confirm receipt of goods.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
        noValidate
        className="space-y-4"
      >
        <Input
          label="Farmer Address"
          placeholder="G..."
          value={farmer}
          onChange={(e) => {
            setFarmer(e.target.value);
            if (errors.farmer) setErrors((prev) => ({ ...prev, farmer: undefined }));
          }}
          error={errors.farmer}
          maxLength={56}
        />

        <Input
          label="Amount (XLM)"
          type="number"
          placeholder="0.00"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            if (errors.amount) setErrors((prev) => ({ ...prev, amount: undefined }));
          }}
          error={errors.amount}
        />

        <div>
          <label htmlFor="order-description" className="block text-sm font-medium text-foreground mb-1.5">
            Description (optional)
          </label>
          <textarea
            id="order-description"
            className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm text-foreground placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            placeholder="e.g. 50kg organic tomatoes"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </div>

        {isValid && (
          <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-600">You pay</span>
              <span className="font-semibold text-foreground">{numAmount.toFixed(2)} XLM</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-600">Platform fee ({PLATFORM_FEE_PCT}%)</span>
              <span className="text-neutral-500">{fee.toFixed(2)} XLM</span>
            </div>
            <div className="border-t border-neutral-200 pt-2 flex justify-between">
              <span className="text-neutral-600">Farmer receives</span>
              <span className="font-semibold text-primary-700">{farmerReceives.toFixed(2)} XLM</span>
            </div>
          </div>
        )}

        {(createState.error || txStep === "error") && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700" role="alert">
            {createState.error ?? "Transaction failed. Please try again."}
          </div>
        )}

        <Button
          variant="primary"
          fullWidth
          size="lg"
          disabled={!isValid}
          isLoading={createState.isLoading}
          onClick={handleSubmit}
        >
          {txStep === "signing" ? "Sign in Wallet..." : "Confirm & Create Order"}
        </Button>
      </form>
    </Card>
  );
}
