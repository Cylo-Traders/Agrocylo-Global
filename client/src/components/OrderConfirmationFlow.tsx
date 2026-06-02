"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ShieldCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import OrderPhotoUpload from "@/components/OrderPhotoUpload";
import { cn } from "@/lib/utils";

export interface OrderConfirmationDetails {
  id: string;
  productName: string;
  sellerName: string;
  buyerName: string;
  quantity: number;
  unit: string;
  pricePerUnit: string;
  totalAmount: string;
  expectedCondition: string;
  listingSnapshot?: {
    quantity: number;
    condition: string;
    notes?: string;
  };
}

export interface OrderConfirmationPayload {
  orderId: string;
  rating: number;
  quantityReceived: number;
  hasDamage: boolean;
  missingItems: string;
  photoFiles: File[];
  confirmedAt: string;
}

interface OrderConfirmationFlowProps {
  order: OrderConfirmationDetails;
  onSubmit: (data: OrderConfirmationPayload) => void | Promise<void>;
  onDispute?: () => void;
  isSubmitting?: boolean;
}

export default function OrderConfirmationFlow({
  order,
  onSubmit,
  onDispute,
  isSubmitting = false,
}: OrderConfirmationFlowProps) {
  const [rating, setRating] = useState<number>(4);
  const [quantityReceived, setQuantityReceived] = useState<string>(String(order.quantity));
  const [hasDamage, setHasDamage] = useState(false);
  const [missingItems, setMissingItems] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const quantityNumber = useMemo(() => {
    const parsed = parseInt(quantityReceived, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }, [quantityReceived]);

  const quantityMismatch = quantityNumber !== order.quantity;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setIsBusy(true);

    try {
      await Promise.resolve(
        onSubmit({
          orderId: order.id,
          rating,
          quantityReceived: quantityNumber,
          hasDamage,
          missingItems: missingItems.trim(),
          photoFiles,
          confirmedAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit order confirmation.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDispute = () => {
    if (onDispute) {
      onDispute();
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <Card className="overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>Review your order before confirmation</CardTitle>
            <CardDescription>
              Confirm receipt only once you have reviewed the product, quantity and condition.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            Safe escrow release guidance
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <section className="space-y-4 rounded-3xl border border-border bg-background p-5">
              <div className="space-y-3">
                <p className="text-sm font-semibold">Order details review</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-secondary/50 p-4">
                    <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Product</p>
                    <p className="mt-2 font-semibold">{order.productName}</p>
                  </div>
                  <div className="rounded-2xl bg-secondary/50 p-4">
                    <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Seller</p>
                    <p className="mt-2 font-semibold">{order.sellerName}</p>
                  </div>
                  <div className="rounded-2xl bg-secondary/50 p-4">
                    <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Quantity</p>
                    <p className="mt-2 font-semibold">
                      {order.quantity} {order.unit}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-secondary/50 p-4">
                    <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Total</p>
                    <p className="mt-2 font-semibold">{order.totalAmount}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Expected condition</p>
                  <p className="mt-2 text-sm leading-relaxed">{order.expectedCondition}</p>
                </div>
                <div className="rounded-3xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Listing snapshot</p>
                  <p className="mt-2 text-sm leading-relaxed">
                    {order.listingSnapshot?.quantity ?? order.quantity} {order.unit} · {order.listingSnapshot?.condition ?? "Market standard"}
                  </p>
                  {order.listingSnapshot?.notes ? (
                    <p className="mt-2 text-sm text-muted-foreground">{order.listingSnapshot.notes}</p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-3xl border border-border bg-secondary/40 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-5 text-amber-600" />
                <div>
                  <p className="font-semibold">Before you confirm</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Confirming releases funds to the seller and closes the order. Keep photos and notes if you anticipate a dispute.
                  </p>
                </div>
              </div>
              <div className="rounded-3xl bg-background p-4 text-sm leading-6 text-muted-foreground">
                <p className="font-semibold">Dispute cost guidance</p>
                <p className="mt-2">
                  Disputes can delay resolution and may require additional evidence. Use the upload section to capture any damage or missing items now.
                </p>
              </div>
            </section>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Quality assessment</CardTitle>
          <CardDescription>Share a quick review of the delivered order so the escrow release is accurate.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-4 rounded-3xl border border-border bg-secondary/40 p-5">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Quality rating</Label>
              <div className="flex flex-wrap items-center gap-2">
                {Array.from({ length: 5 }, (_, index) => {
                  const value = index + 1;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-label={`${value} star${value > 1 ? "s" : ""}`}
                      onClick={() => setRating(value)}
                      className={cn(
                        "inline-flex h-11 w-11 items-center justify-center rounded-2xl border text-xl transition",
                        value <= rating
                          ? "border-amber-300 bg-amber-100 text-amber-600"
                          : "border-border bg-background text-muted-foreground hover:border-primary/70",
                      )}
                    >
                      <Star className="size-5" />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="quantity-received" className="text-sm font-semibold">
                  Quantity received
                </Label>
                <Input
                  id="quantity-received"
                  type="number"
                  inputMode="numeric"
                  value={quantityReceived}
                  onChange={(event) => setQuantityReceived(event.target.value)}
                  min={0}
                  className="max-w-[150px]"
                />
                {quantityMismatch ? (
                  <p className="text-destructive text-sm">Received quantity differs from the order. Double check the shipment.</p>
                ) : (
                  <p className="text-muted-foreground text-sm">Matches the expected order quantity.</p>
                )}
              </div>
              <div className="rounded-3xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Damage assessment</p>
                  <Switch checked={hasDamage} onCheckedChange={setHasDamage} />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Toggle on if the shipment has visible damage, broken goods, or packaging issues.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="missing-items" className="text-sm font-semibold">
                Missing items or shortages
              </Label>
              <Textarea
                id="missing-items"
                value={missingItems}
                onChange={(event) => setMissingItems(event.target.value)}
                placeholder="Describe any missing units, damaged packages, or items that differ from the listing."
              />
            </div>

            <div className="flex items-center gap-3 rounded-3xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
              <Camera className="size-5 text-primary" />
              <div>
                <p className="font-semibold">Photo evidence helps avoid disputes</p>
                <p className="mt-1">Upload images when there is damage or missing quantity to support your confirmation.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Upload delivery photos</CardTitle>
          <CardDescription>Photos are strongly recommended in case the order is disputed later.</CardDescription>
        </CardHeader>

        <CardContent>
          <OrderPhotoUpload value={photoFiles} onChange={setPhotoFiles} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="space-y-4">
          <div className="rounded-3xl border border-border bg-secondary/40 p-5 text-sm leading-6 text-muted-foreground">
            <p className="font-semibold">Dispute prevention</p>
            <p className="mt-2">
              Compare received goods with the seller's listing and only confirm once the order matches the expected quality and quantity.
            </p>
            <p className="mt-2">
              Confirming means funds are released. If you disagree with the delivery, choose dispute instead of confirming immediately.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">Listing comparison</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Expected condition: {order.expectedCondition}
              </p>
            </div>
            <div className="rounded-3xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">What to watch for</p>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                <li>- Damaged packaging or broken goods</li>
                <li>- Incorrect quantity or missing lots</li>
                <li>- Product quality below the listing description</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {submitError ? (
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {submitError}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <Button type="submit" isLoading={isBusy || isSubmitting} className="w-full" size="lg">
          Confirm Receipt &amp; Release Funds
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleDispute}
          disabled={!onDispute}
          className="w-full"
          size="lg"
        >
          Dispute Order
        </Button>
      </div>

      <div className="rounded-3xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 text-amber-800">
          <AlertTriangle className="size-4" />
          <p>Disputes often require extra evidence and may slow resolution. Use them only when the delivery does not match the order.</p>
        </div>
      </div>
    </form>
  );
}
