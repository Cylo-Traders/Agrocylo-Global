"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Wallet, ShieldCheck } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useEscrowContract } from "@/hooks/useEscrowContract";
import { useWallet } from "@/hooks/useWallet";
import { useAnalytics } from "@/hooks/useAnalytics";
import { createOrderFormSchema } from "@/lib/validation";
import { FormError } from "@/components/FormError";

const PLATFORM_FEE_PCT = 3;

const NATIVE_TOKEN_CONTRACT_ID =
  process.env.NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID ?? "";

type FormErrors = Partial<Record<"farmer" | "amount" | "deliveryDeadline", string>>;

export default function CreateOrderForm() {
  const searchParams = useSearchParams();
  const prefilledFarmer = searchParams.get("farmer") ?? "";

  const { connected } = useWallet();
  const { createOrder, createState } = useEscrowContract();
  const { trackFunnelStep, trackTransactionAttempt, trackFormSubmission } =
    useAnalytics();

  const [farmer, setFarmer] = useState(prefilledFarmer);
  const [amount, setAmount] = useState("");
  const [deliveryDeadline, setDeliveryDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [txStep, setTxStep] = useState<"idle" | "signing" | "done" | "error">(
    "idle",
  );
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  const numAmount = parseFloat(amount);
  const hasAmount = numAmount > 0;

  const fee = hasAmount ? (numAmount * PLATFORM_FEE_PCT) / 100 : 0;
  const farmerReceives = hasAmount ? numAmount - fee : 0;

  function validate(): boolean {
    const result = createOrderFormSchema.safeParse({
      farmer: farmer.trim(),
      amount,
      deliveryDeadline,
      description: description || undefined,
    });

    if (!result.success) {
      const fieldMap: Record<string, keyof FormErrors> = {
        farmer: "farmer",
        amount: "amount",
        deliveryDeadline: "deliveryDeadline",
      };
      const next: FormErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path?.[0] as string;
        const formKey = fieldMap[field];
        if (formKey && !next[formKey]) {
          next[formKey] = issue.message;
        }
      }
      setErrors(next);
      return false;
    }

    setErrors({});
    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (!NATIVE_TOKEN_CONTRACT_ID) {
      setTxStep("error");
      return;
    }
    try {
      trackFormSubmission("escrow_order_form", {
        farmer: farmer.trim(),
        amount: numAmount,
      });
      trackTransactionAttempt("purchase", "started", {
        farmer: farmer.trim(),
        amount: numAmount,
        deadline: deliveryDeadline,
      });
      trackFunnelStep("purchase", "checkout_submitted", {
        amount: numAmount,
      });
      setTxStep("signing");
      const stroops = BigInt(Math.round(numAmount * 1e7));
      const result = await createOrder(
        farmer.trim(),
        NATIVE_TOKEN_CONTRACT_ID,
        stroops,
        deliveryDeadline,
      );
      setTxStep("done");
      setTxHash(result?.txHash ?? null);
      trackTransactionAttempt("purchase", "confirmed", {
        farmer: farmer.trim(),
        amount: numAmount,
      });
      trackFunnelStep("purchase", "checkout_completed", {
        amount: numAmount,
      });
    } catch {
      setTxStep("error");
      trackTransactionAttempt("purchase", "failed", {
        farmer: farmer.trim(),
        amount: numAmount,
      });
    }
  }

  if (txStep === "done") {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="bg-primary/10 grid size-16 place-content-center rounded-full">
            <CheckCircle2 className="text-primary size-8" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Order Created</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Funds are now locked in escrow. The farmer ships, you confirm
              receipt, the contract releases payment.
            </p>
          </div>
          {txHash && (
            <div className="bg-secondary/50 w-full rounded-xl border p-3 text-left">
              <p className="text-muted-foreground text-xs">Transaction hash</p>
              <p className="font-mono mt-1 break-all text-xs">{txHash}</p>
            </div>
          )}
          <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row">
            <Button asChild className="flex-1">
              <Link href="/orders">View Orders</Link>
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setTxStep("idle");
                setAmount("");
                setDeliveryDeadline("");
                setDescription("");
                setTxHash(null);
                trackFunnelStep("purchase", "checkout_reset");
              }}
            >
              Create Another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!connected) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="bg-secondary text-muted-foreground grid size-12 place-content-center rounded-full">
            <Wallet className="size-5" />
          </div>
          <h2 className="text-lg font-semibold">Connect your wallet</h2>
          <p className="text-muted-foreground text-sm">
            Sign in with Freighter to create an escrow order.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!NATIVE_TOKEN_CONTRACT_ID) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="space-y-2 py-6 text-sm">
          <h2 className="font-semibold">Token contract not configured</h2>
          <p className="text-muted-foreground">
            Set{" "}
            <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
              NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID
            </code>{" "}
            in{" "}
            <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
              .env.local
            </code>{" "}
            to the XLM SAC for your network before the form will work.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <ShieldCheck className="text-primary size-5" />
          Create Escrow Order
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          Funds are held in a Soroban escrow until you confirm receipt of
          goods. If the farmer doesn&apos;t deliver in time, you can refund.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <Input
          label="Farmer Address"
          placeholder="G…"
          value={farmer}
          onChange={(e) => {
            setFarmer(e.target.value);
            if (errors.farmer) setErrors((prev) => ({ ...prev, farmer: undefined }));
          }}
          spellCheck={false}
          error={errors.farmer}
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

        <Input
          label="Delivery deadline"
          hint="If the farmer doesn't deliver by this time, you can refund the escrow."
          type="datetime-local"
          value={deliveryDeadline}
          onChange={(e) => {
            setDeliveryDeadline(e.target.value);
            if (errors.deliveryDeadline) setErrors((prev) => ({ ...prev, deliveryDeadline: undefined }));
          }}
          error={errors.deliveryDeadline}
        />

        <div className="grid w-full gap-1.5">
          <Label htmlFor="order-description">Description (optional)</Label>
          <Textarea
            id="order-description"
            rows={2}
            placeholder="e.g. 50kg organic tomatoes"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {hasAmount && (
          <div className="bg-secondary/40 space-y-2 rounded-2xl border p-4 text-sm">
            <Row label="You pay" value={`${numAmount.toFixed(2)} XLM`} />
            <Row
              label={`Platform fee (${PLATFORM_FEE_PCT}%)`}
              value={`${fee.toFixed(2)} XLM`}
              muted
            />
            <Separator />
            <Row
              label="Farmer receives"
              value={`${farmerReceives.toFixed(2)} XLM`}
              bold
            />
          </div>
        )}

        {(createState.error || txStep === "error") && (
          <FormError message={createState.error ?? "Transaction failed. Please try again."} />
        )}

        <Button
          size="lg"
          disabled={!farmer.trim() || !amount || !deliveryDeadline}
          isLoading={createState.isLoading}
          onClick={handleSubmit}
          className="w-full"
        >
          {txStep === "signing"
            ? "Sign in wallet…"
            : "Confirm & Create Escrow Order"}
        </Button>
      </CardContent>
    </Card>
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
      className={`flex justify-between ${
        muted ? "text-muted-foreground" : ""
      } ${bold ? "text-base font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
