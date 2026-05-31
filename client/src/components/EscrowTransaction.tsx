"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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

interface EscrowTransactionProps {
  farmerAddress: string;
  tokenAddress: string;
  pricePerUnit: number;
  productName: string;
}

type Status = "idle" | "pending" | "confirming" | "success" | "error";
interface TransactionStatus {
  status: Status;
  message?: string;
  txHash?: string;
}

const PLATFORM_FEE_PCT = 3;

export default function EscrowTransaction({
  farmerAddress,
  tokenAddress,
  pricePerUnit,
  productName,
}: EscrowTransactionProps) {
  const { address, connected, network } = useWallet();
  const [quantity, setQuantity] = useState<string>("1");
  const [deliveryDeadline, setDeliveryDeadline] = useState<string>("");
  const [tx, setTx] = useState<TransactionStatus>({ status: "idle" });

  const qtyNum = parseFloat(quantity || "0");
  const totalPrice = qtyNum * pricePerUnit;
  const fee = (totalPrice * PLATFORM_FEE_PCT) / 100;
  const farmerReceives = totalPrice - fee;
  const totalStroops = BigInt(Math.floor(totalPrice * 10_000_000));

  const busy = tx.status === "pending" || tx.status === "confirming";

  function validate(): string | null {
    if (!farmerAddress) return "Farmer address is missing.";
    if (!tokenAddress) return "Token contract address is missing.";
    if (!qtyNum || qtyNum <= 0) return "Please enter a valid quantity.";
    if (!deliveryDeadline) return "Please select a delivery deadline.";
    if (new Date(deliveryDeadline) <= new Date())
      return "Delivery deadline must be in the future.";
    return null;
  }

  async function callCreateOrder() {
    const err = validate();
    if (err) {
      setTx({ status: "error", message: err });
      return;
    }

    setTx({ status: "pending", message: "Building escrow transaction…" });

    try {
      if (!connected || !address) {
        throw new Error("Please connect your wallet first");
      }

      const unsignedXdr = await createOrder(
        address,
        farmerAddress,
        tokenAddress,
        totalStroops,
        deliveryDeadline,
      );
      if (!unsignedXdr.success || !unsignedXdr.data) {
        throw new Error(unsignedXdr.error || "Failed to build escrow transaction");
      }

      setTx({
        status: "confirming",
        message: "Please confirm the transaction in your wallet…",
      });
      notifyTransactionConfirming();

      const signed = await signAndSubmitTransaction(unsignedXdr.data);
      if (!signed.success || !signed.txHash) {
        throw new Error(signed.error || "Transaction failed");
      }

      notifyTransactionSubmitted();
      setTimeout(() => notifyTransactionConfirmed(signed.txHash), 2000);

      setTx({
        status: "success",
        message: "Escrow order created on-chain.",
        txHash: signed.txHash,
      });
    } catch (error) {
      const info = mapBlockchainError(error);
      setTx({
        status: "error",
        message: `${info.title}: ${info.message} ${info.action}`,
      });
    }
  }

  if (!connected) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="bg-secondary text-muted-foreground grid size-12 place-content-center rounded-full">
            <Wallet className="size-5" />
          </div>
          <h2 className="text-lg font-semibold">Connect your wallet</h2>
          <p className="text-muted-foreground text-sm">
            Sign in with Freighter to fund an escrow.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="text-primary size-5" />
          Escrow for {productName}
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          Funds lock in a Soroban escrow until you confirm receipt of goods.
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Order context */}
        <div className="bg-secondary/40 grid gap-4 rounded-2xl border p-4 sm:grid-cols-2">
          <Field label="Product" value={productName} />
          <Field label="Price per unit" value={`${pricePerUnit} XLM`} />
          <Field
            label="Farmer"
            value={
              <span className="font-mono">
                {formatTruncatedAddress(farmerAddress)}
              </span>
            }
          />
          <Field
            label="Network"
            value={
              <Badge variant="outline" className="capitalize">
                {network ?? "—"}
              </Badge>
            }
          />
        </div>

        {/* Quantity */}
        <Input
          label="Quantity"
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          hint="Number of units to purchase."
        />

        {/* Total panel */}
        <div className="bg-primary/5 border-primary/20 space-y-3 rounded-2xl border p-4">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">Total locked</span>
            <span className="text-primary text-2xl font-bold">
              {totalPrice.toFixed(2)} XLM
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            {qtyNum > 0 ? `${qtyNum} units × ${pricePerUnit} XLM each` : "—"}
          </p>
          <Separator />
          <div className="space-y-1 text-sm">
            <Row
              label={`Platform fee (${PLATFORM_FEE_PCT}%)`}
              value={`${fee.toFixed(2)} XLM`}
              muted
            />
            <Row
              label="Farmer receives"
              value={`${farmerReceives.toFixed(2)} XLM`}
              bold
            />
          </div>
        </div>

        {/* Delivery deadline */}
        <Input
          label="Delivery deadline"
          type="datetime-local"
          value={deliveryDeadline}
          onChange={(e) => setDeliveryDeadline(e.target.value)}
          hint="If the farmer doesn't deliver by this time, you can refund."
        />

        {/* Status */}
        {tx.status !== "idle" && <StatusPanel tx={tx} />}
      </CardContent>

      <CardFooter className="flex gap-3">
        <Button
          onClick={() => void callCreateOrder()}
          isLoading={busy}
          disabled={busy}
          size="lg"
          className="flex-1"
        >
          {busy ? "Processing…" : "Create Escrow Order"}
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            setQuantity("1");
            setDeliveryDeadline("");
            setTx({ status: "idle" });
          }}
          disabled={busy}
        >
          Reset
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="mt-0.5 text-sm font-medium break-words">{value}</div>
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
        "flex justify-between",
        muted && "text-muted-foreground",
        bold && "text-base font-semibold",
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
      ? "primary"
      : tx.status === "error"
        ? "destructive"
        : "secondary";
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 text-sm",
        tone === "primary" && "bg-primary/5 border-primary/30",
        tone === "destructive" &&
          "bg-destructive/10 border-destructive/30 text-destructive",
        tone === "secondary" && "bg-secondary/50",
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        {tx.status === "pending" || tx.status === "confirming" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : tx.status === "success" ? (
          <CheckCircle2 className="text-primary size-4" />
        ) : (
          <ShieldAlert className="size-4" />
        )}
        {tx.status === "pending"
          ? "Preparing"
          : tx.status === "confirming"
            ? "Awaiting signature"
            : tx.status === "success"
              ? "Success"
              : "Error"}
      </div>
      {tx.message && <p className="mt-2 text-sm">{tx.message}</p>}
      {tx.txHash && (
        <p className="text-muted-foreground font-mono mt-2 text-xs break-all">
          Tx: {tx.txHash}
        </p>
      )}
    </div>
  );
}
