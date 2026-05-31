"use client";

import { useState, useEffect } from "react";
import {
  Check,
  X,
  Plus,
  Minus,
  Calendar,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  Wallet,
  Loader2,
  CheckCircle2,
  Info,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";
import { mapBlockchainError } from "@/components/errorHandler";
import { createOrder } from "@/services/stellar/contractService";
import { signAndSubmitTransaction } from "@/lib/signTransaction";
import {
  notifyTransactionSubmitted,
  notifyTransactionConfirmed,
  notifyTransactionConfirming,
} from "@/services/notification";
import { formatTruncatedAddress } from "@/lib/helpers/format-address";
import { cn } from "@/lib/utils";

interface EnhancedEscrowTransactionProps {
  farmerAddress: string;
  tokenAddress: string;
  pricePerUnit: number;
  productName: string;
  unit?: string;
  minQuantity?: number;
  maxQuantity?: number;
}

type Status = "idle" | "pending" | "confirming" | "success" | "error";

interface TransactionStatus {
  status: Status;
  message?: string;
  txHash?: string;
}

const PLATFORM_FEE_PCT = 3;

export default function EnhancedEscrowTransaction({
  farmerAddress,
  tokenAddress,
  pricePerUnit,
  productName,
  unit = "units",
  minQuantity = 1,
  maxQuantity = 100000,
}: EnhancedEscrowTransactionProps) {
  const { address, connected, network } = useWallet();

  const [quantity, setQuantity] = useState<string>("1");
  const [deliveryDeadline, setDeliveryDeadline] = useState<string>("");
  const [touched, setTouched] = useState<{ quantity?: boolean; deliveryDeadline?: boolean }>({});
  const [errors, setErrors] = useState<{ quantity?: string; deliveryDeadline?: string }>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [tx, setTx] = useState<TransactionStatus>({ status: "idle" });

  const qtyNum = parseFloat(quantity || "0");
  const totalPrice = qtyNum * pricePerUnit;
  const fee = (totalPrice * PLATFORM_FEE_PCT) / 100;
  const farmerReceives = totalPrice - fee;
  const totalStroops = BigInt(Math.floor(totalPrice * 10_000_000));

  const busy = tx.status === "pending" || tx.status === "confirming";

  // Field validator helper
  const validateField = (name: "quantity" | "deliveryDeadline", val: string): string | undefined => {
    if (name === "quantity") {
      if (!val || val.trim() === "") return "Quantity is required";
      const num = parseFloat(val);
      if (isNaN(num) || num <= 0) return "Must be a valid positive number";
      if (num < minQuantity) return `Minimum allowed quantity is ${minQuantity} ${unit}`;
      if (num > maxQuantity) return `Maximum allowed quantity is ${maxQuantity} ${unit}`;
    }
    if (name === "deliveryDeadline") {
      if (!val) return "Delivery deadline is required";
      const selected = new Date(val);
      if (isNaN(selected.getTime())) return "Invalid date format";
      if (selected <= new Date()) return "Deadline must be in the future";
    }
    return undefined;
  };

  // Perform real-time validation on change
  const handleQuantityChange = (val: string) => {
    setQuantity(val);
    const err = validateField("quantity", val);
    setErrors((prev) => ({ ...prev, quantity: err }));
  };

  const handleDeadlineChange = (val: string) => {
    setDeliveryDeadline(val);
    const err = validateField("deliveryDeadline", val);
    setErrors((prev) => ({ ...prev, deliveryDeadline: err }));
  };

  const handleBlur = (field: "quantity" | "deliveryDeadline") => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const val = field === "quantity" ? quantity : deliveryDeadline;
    const err = validateField(field, val);
    setErrors((prev) => ({ ...prev, [field]: err }));
  };

  // Preset Date Helper
  const applyPreset = (days: number) => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + days);
    
    // Convert to native local input format (YYYY-MM-DDThh:mm)
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, "0");
    const date = String(targetDate.getDate()).padStart(2, "0");
    const hours = String(targetDate.getHours()).padStart(2, "0");
    const minutes = String(targetDate.getMinutes()).padStart(2, "0");
    
    const formatted = `${year}-${month}-${date}T${hours}:${minutes}`;
    setDeliveryDeadline(formatted);
    setTouched((prev) => ({ ...prev, deliveryDeadline: true }));
    setErrors((prev) => ({ ...prev, deliveryDeadline: undefined }));
  };

  const incrementQty = () => {
    const current = parseFloat(quantity) || 0;
    const next = Math.min(maxQuantity, current + 1);
    handleQuantityChange(String(next));
  };

  const decrementQty = () => {
    const current = parseFloat(quantity) || 0;
    const next = Math.max(minQuantity, current - 1);
    handleQuantityChange(String(next));
  };

  const hasErrors = !!errors.quantity || !!errors.deliveryDeadline;
  const isFormValid =
    quantity !== "" &&
    deliveryDeadline !== "" &&
    !hasErrors &&
    qtyNum >= minQuantity &&
    qtyNum <= maxQuantity;

  async function executeTransaction() {
    setShowConfirm(false);
    setTx({ status: "pending", message: "Building Soroban escrow order transaction…" });

    try {
      if (!connected || !address) {
        throw new Error("Please connect your Freighter wallet to continue.");
      }

      const unsignedXdr = await createOrder(
        address,
        farmerAddress,
        tokenAddress,
        totalStroops,
        deliveryDeadline
      );

      if (!unsignedXdr.success || !unsignedXdr.data) {
        throw new Error(unsignedXdr.error || "Failed to generate Soroban transaction envelope.");
      }

      setTx({
        status: "confirming",
        message: "Please sign the transaction request inside your Freighter extension.",
      });
      notifyTransactionConfirming();

      const signed = await signAndSubmitTransaction(unsignedXdr.data);
      if (!signed.success || !signed.txHash) {
        throw new Error(signed.error || "Transaction submission was cancelled or failed.");
      }

      notifyTransactionSubmitted();
      setTimeout(() => notifyTransactionConfirmed(signed.txHash), 2000);

      setTx({
        status: "success",
        message: "On-chain escrow transaction successful! Funds are now securely locked.",
        txHash: signed.txHash,
      });
    } catch (err) {
      const info = mapBlockchainError(err);
      setTx({
        status: "error",
        message: `${info.title}: ${info.message}. ${info.action}`,
      });
    }
  }

  // Format currency helpers
  const formatXLM = (num: number) => {
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " XLM";
  };

  return (
    <div className="space-y-6">
      <Card className="mx-auto max-w-2xl overflow-hidden border shadow-lg transition-all duration-300 hover:shadow-xl dark:border-zinc-800">
        <CardHeader className="bg-gradient-to-r from-primary/5 via-transparent to-primary/5 pb-6">
          <CardTitle className="flex items-center gap-3 text-lg font-bold sm:text-xl">
            <div className="bg-primary/10 text-primary grid size-10 place-content-center rounded-xl">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <span>Escrow for {productName}</span>
              <p className="text-muted-foreground text-xs font-normal mt-0.5">
                Powered by Soroban Smart Contracts
              </p>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6 pt-2">
          {/* Transaction context block */}
          <div className="bg-zinc-50/50 dark:bg-zinc-900/30 border border-zinc-100 dark:border-zinc-800/80 grid gap-4 rounded-2xl p-4 sm:grid-cols-2">
            <Field label="Target Product" value={productName} />
            <Field label="Unit Price" value={`${pricePerUnit.toFixed(2)} XLM per ${unit}`} />
            <Field
              label="Recipient Address"
              value={
                <span className="font-mono text-xs text-muted-foreground bg-zinc-100/50 dark:bg-zinc-800 px-1.5 py-0.5 rounded border">
                  {formatTruncatedAddress(farmerAddress)}
                </span>
              }
            />
            <Field
              label="Stellar Network"
              value={
                <Badge variant="outline" className="capitalize text-xs font-medium border-primary/20 bg-primary/[0.02]">
                  {network?.toLowerCase() ?? "sandbox"}
                </Badge>
              }
            />
          </div>

          {/* Quantity Field */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="quantity-input" className="text-sm font-semibold flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
                Purchase Quantity ({unit})
              </label>
              {touched.quantity && (
                <span className="flex items-center gap-1 text-xs">
                  {errors.quantity ? (
                    <span className="text-destructive flex items-center gap-1">
                      <X className="size-3.5" /> Invalid
                    </span>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Check className="size-3.5" /> Valid
                    </span>
                  )}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={decrementQty}
                disabled={busy || qtyNum <= minQuantity}
                className="size-10 rounded-xl"
                aria-label="Decrease quantity"
              >
                <Minus className="size-4" />
              </Button>

              <div className="relative flex-1">
                <input
                  id="quantity-input"
                  type="text"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                  onBlur={() => handleBlur("quantity")}
                  disabled={busy}
                  className={cn(
                    "flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-center font-semibold ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                    touched.quantity && errors.quantity && "border-destructive focus-visible:ring-destructive",
                    touched.quantity && !errors.quantity && "border-emerald-500 focus-visible:ring-emerald-500"
                  )}
                  placeholder="0.00"
                />
              </div>

              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={incrementQty}
                disabled={busy || qtyNum >= maxQuantity}
                className="size-10 rounded-xl"
                aria-label="Increase quantity"
              >
                <Plus className="size-4" />
              </Button>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span>Constraint: {minQuantity} - {maxQuantity} {unit}</span>
              {touched.quantity && errors.quantity && (
                <span className="text-destructive font-medium flex items-center gap-1">
                  <AlertCircle className="size-3" /> {errors.quantity}
                </span>
              )}
            </div>
          </div>

          {/* Pricing Breakdown Summary */}
          <div className="bg-zinc-50/50 dark:bg-zinc-900/30 border border-zinc-150 dark:border-zinc-800 space-y-3 rounded-2xl p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Total Price Locked</span>
              <span className="text-primary text-xl font-bold tracking-tight sm:text-2xl">
                {formatXLM(totalPrice)}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {qtyNum > 0 ? `${qtyNum.toLocaleString()} ${unit} × ${pricePerUnit.toFixed(2)} XLM per ${unit}` : "No units specified"}
            </p>
            <Separator className="bg-zinc-200 dark:bg-zinc-800" />
            <div className="space-y-1.5 text-xs sm:text-sm">
              <Row
                label={`Soroban Protocol Fee (${PLATFORM_FEE_PCT}%)`}
                value={formatXLM(fee)}
                muted
              />
              <Row
                label="Farmer Payout"
                value={formatXLM(farmerReceives)}
                bold
              />
            </div>
          </div>

          {/* Delivery Deadline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="deadline-input" className="text-sm font-semibold flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
                Delivery Deadline
              </label>
              {touched.deliveryDeadline && (
                <span className="flex items-center gap-1 text-xs">
                  {errors.deliveryDeadline ? (
                    <span className="text-destructive flex items-center gap-1">
                      <X className="size-3.5" /> Invalid
                    </span>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Check className="size-3.5" /> Valid
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="relative">
              <input
                id="deadline-input"
                type="datetime-local"
                value={deliveryDeadline}
                onChange={(e) => handleDeadlineChange(e.target.value)}
                onBlur={() => handleBlur("deliveryDeadline")}
                disabled={busy}
                className={cn(
                  "flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                  touched.deliveryDeadline && errors.deliveryDeadline && "border-destructive focus-visible:ring-destructive",
                  touched.deliveryDeadline && !errors.deliveryDeadline && "border-emerald-500 focus-visible:ring-emerald-500"
                )}
              />
            </div>

            {/* Presets */}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(7)}
                  disabled={busy}
                  className="h-7 text-xs rounded-lg px-2.5 font-medium border-zinc-200 hover:bg-zinc-100"
                >
                  7 Days Preset
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(14)}
                  disabled={busy}
                  className="h-7 text-xs rounded-lg px-2.5 font-medium border-zinc-200 hover:bg-zinc-100"
                >
                  14 Days Preset
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(30)}
                  disabled={busy}
                  className="h-7 text-xs rounded-lg px-2.5 font-medium border-zinc-200 hover:bg-zinc-100"
                >
                  30 Days Preset
                </Button>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>Must be in future. Funds are refundable if delivery expires.</span>
                {touched.deliveryDeadline && errors.deliveryDeadline && (
                  <span className="text-destructive font-medium flex items-center gap-1">
                    <AlertCircle className="size-3" /> {errors.deliveryDeadline}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Status Display Panel */}
          {tx.status !== "idle" && <StatusPanel tx={tx} />}
        </CardContent>

        <CardFooter className="flex gap-3 bg-zinc-50/20 dark:bg-zinc-900/10 border-t py-4 dark:border-zinc-800">
          <Button
            onClick={() => setShowConfirm(true)}
            disabled={busy || !isFormValid}
            size="lg"
            className="flex-1 rounded-xl text-sm font-semibold tracking-wide"
          >
            Create Escrow Order
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              setQuantity("1");
              setDeliveryDeadline("");
              setTouched({});
              setErrors({});
              setTx({ status: "idle" });
            }}
            disabled={busy}
            className="rounded-xl text-sm font-medium border-zinc-200"
          >
            Reset Form
          </Button>
        </CardFooter>
      </Card>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-md rounded-2xl border shadow-xl overflow-hidden p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 grid size-10 place-content-center rounded-xl">
                <Info className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-950 dark:text-zinc-55">
                  Confirm On-Chain Escrow Terms
                </h3>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Verify transaction terms before submitting
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
              <div className="flex justify-between">
                <span>Product Name</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{productName}</span>
              </div>
              <div className="flex justify-between">
                <span>Purchase Quantity</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {qtyNum} {unit}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Total Escrow Amount</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatXLM(totalPrice)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Estimated Payout</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatXLM(farmerReceives)}
                </span>
              </div>
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-xs text-muted-foreground">Delivery Deadline</span>
                <span className="text-xs font-mono font-semibold bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded border text-zinc-900 dark:text-zinc-100">
                  {new Date(deliveryDeadline).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs text-muted-foreground leading-normal flex gap-2">
              <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
              <span>
                Funds will be locked securely by the smart contract and released only upon your delivery confirmation or returned if expired.
              </span>
            </div>

            <div className="flex gap-3 pt-2">
              <Button onClick={() => void executeTransaction()} className="flex-1 rounded-xl text-xs font-semibold">
                Confirm & Submit
              </Button>
              <Button variant="outline" onClick={() => setShowConfirm(false)} className="flex-1 rounded-xl text-xs font-medium border-zinc-200">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper components
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between items-center",
        muted && "text-muted-foreground",
        bold && "text-sm font-semibold text-zinc-850 dark:text-zinc-150"
      )}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StatusPanel({ tx }: { tx: TransactionStatus }) {
  const tone =
    tx.status === "success"
      ? "success"
      : tx.status === "error"
        ? "error"
        : "pending";

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 text-sm animate-in fade-in duration-300",
        tone === "success" && "bg-emerald-50/50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-900/50 dark:text-emerald-300",
        tone === "error" && "bg-rose-50/50 border-rose-200 text-rose-800 dark:bg-rose-950/20 dark:border-rose-900/50 dark:text-rose-300",
        tone === "pending" && "bg-blue-50/50 border-blue-200 text-blue-800 dark:bg-blue-950/20 dark:border-blue-900/50 dark:text-blue-300"
      )}
    >
      <div className="flex items-center gap-2 font-bold">
        {tx.status === "pending" || tx.status === "confirming" ? (
          <Loader2 className="size-4 animate-spin text-blue-600 dark:text-blue-400" />
        ) : tx.status === "success" ? (
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertCircle className="size-4 text-rose-600 dark:text-rose-400" />
        )}
        <span className="capitalize">
          {tx.status === "pending"
            ? "Simulating transaction"
            : tx.status === "confirming"
              ? "Awaiting signature confirmation"
              : tx.status === "success"
                ? "On-Chain confirmation complete"
                : "Transaction Error"}
        </span>
      </div>
      {tx.message && <p className="mt-2 text-xs leading-normal">{tx.message}</p>}
      {tx.txHash && (
        <div className="mt-3 flex items-center justify-between bg-white/60 dark:bg-black/20 rounded-lg p-2 border border-zinc-150/40 dark:border-zinc-800/40">
          <span className="font-mono text-[10px] break-all truncate select-all pr-4">
            Hash: {tx.txHash}
          </span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 select-none">
            Success
          </span>
        </div>
      )}
    </div>
  );
}
