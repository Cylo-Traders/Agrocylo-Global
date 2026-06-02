"use client";

import { useState } from "react";
import { ArrowLeftRight, Plus, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import type {
  ProductCategory,
  ProductCurrency,
  ProductUnit,
} from "@/types/product";
import type { BarterOfferItem } from "@/types/barter";
import { useAnalytics } from "@/hooks/useAnalytics";
import { createBarterOffer } from "@/services/barterService";

const CATEGORIES: ProductCategory[] = [
  "Vegetables",
  "Fruits",
  "Grains",
  "Tubers",
  "Livestock",
  "Other",
];
const UNITS: ProductUnit[] = ["kg", "bag", "crate", "piece", "litre", "dozen"];
const CURRENCIES: ProductCurrency[] = ["STRK", "USDC"];
const EXPIRY_OPTIONS = [
  { label: "12 hours", value: 12 },
  { label: "24 hours", value: 24 },
  { label: "48 hours", value: 48 },
  { label: "72 hours", value: 72 },
  { label: "7 days", value: 168 },
];

type FormErrors = Partial<
  Record<
    "recipientWallet" | "offerItems" | "requestItems" | "collateral" | "notes",
    string
  >
>;

function emptyItem(): BarterOfferItem {
  return {
    product_name: "",
    category: "Vegetables",
    quantity: "",
    unit: "kg",
  };
}

// ─────────────────────────────────────────────────────────────────────────────

function ItemFieldset({
  label,
  accent,
  items,
  onChange,
  error,
}: {
  label: string;
  accent: "primary" | "amber";
  items: BarterOfferItem[];
  onChange: (items: BarterOfferItem[]) => void;
  error?: string;
}) {
  function update(idx: number, patch: Partial<BarterOfferItem>) {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  const borderClass =
    accent === "primary" ? "border-l-primary" : "border-l-amber-500";

  return (
    <div className={`border-l-4 ${borderClass} space-y-3 pl-4`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, emptyItem()])}
        >
          <Plus className="size-3.5" />
          Add item
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="border-border bg-secondary/30 text-muted-foreground rounded-xl border border-dashed p-4 text-center text-xs">
          No items yet — click &quot;Add item&quot; to start.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="bg-secondary/30 space-y-3 rounded-xl border p-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs font-medium">
                  Item {idx + 1}
                </p>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="text-destructive hover:text-destructive/80 inline-flex items-center gap-1 text-xs"
                  >
                    <Trash2 className="size-3" />
                    Remove
                  </button>
                )}
              </div>

              <Input
                label="Product name"
                value={item.product_name}
                onChange={(e) => update(idx, { product_name: e.target.value })}
                placeholder="e.g. Organic Tomatoes"
                required
              />

              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Category</Label>
                  <select
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
                    value={item.category}
                    onChange={(e) =>
                      update(idx, {
                        category: e.target.value as ProductCategory,
                      })
                    }
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <Input
                  label="Quantity"
                  type="number"
                  min={0}
                  step={0.1}
                  value={item.quantity}
                  onChange={(e) => update(idx, { quantity: e.target.value })}
                  placeholder="50"
                  required
                />

                <div className="grid gap-1.5">
                  <Label className="text-xs">Unit</Label>
                  <select
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
                    value={item.unit}
                    onChange={(e) =>
                      update(idx, { unit: e.target.value as ProductUnit })
                    }
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface BarterOfferFormProps {
  open: boolean;
  walletAddress: string;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

export default function BarterOfferForm({
  open,
  walletAddress,
  onClose,
  onSuccess,
}: BarterOfferFormProps) {
  const { trackFunnelStep, trackFormSubmission, trackTransactionAttempt } =
    useAnalytics();
  const [recipientWallet, setRecipientWallet] = useState("");
  const [offerItems, setOfferItems] = useState<BarterOfferItem[]>([
    emptyItem(),
  ]);
  const [requestItems, setRequestItems] = useState<BarterOfferItem[]>([
    emptyItem(),
  ]);
  const [expiryHours, setExpiryHours] = useState(24);
  const [includeCollateral, setIncludeCollateral] = useState(false);
  const [collateralAmount, setCollateralAmount] = useState("");
  const [collateralCurrency, setCollateralCurrency] =
    useState<ProductCurrency>("STRK");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function validate(): boolean {
    const next: FormErrors = {};

    if (!recipientWallet.trim()) {
      next.recipientWallet = "Recipient wallet address is required.";
    } else if (recipientWallet.trim() === walletAddress) {
      next.recipientWallet = "You cannot barter with yourself.";
    }

    if (offerItems.length === 0) {
      next.offerItems = "Add at least one item you are offering.";
    } else if (
      offerItems.some(
        (i) =>
          !i.product_name.trim() || !i.quantity || Number(i.quantity) <= 0,
      )
    ) {
      next.offerItems =
        "All offer items must have a name and positive quantity.";
    }

    if (requestItems.length === 0) {
      next.requestItems = "Add at least one item you want to receive.";
    } else if (
      requestItems.some(
        (i) =>
          !i.product_name.trim() || !i.quantity || Number(i.quantity) <= 0,
      )
    ) {
      next.requestItems =
        "All request items must have a name and positive quantity.";
    }

    if (includeCollateral) {
      if (!collateralAmount || Number(collateralAmount) <= 0) {
        next.collateral = "Collateral amount must be a positive number.";
      }
    }

    if (notes.length > 500) {
      next.notes = "Notes must be 500 characters or less.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) {
      setSaveError("Wallet is not connected.");
      return;
    }
    if (!validate()) return;

    setSaving(true);
    setSaveError(null);
    trackFormSubmission("barter_offer_form", {
      walletAddress,
      collateral: includeCollateral,
      expiryHours,
    });
    trackTransactionAttempt("barter", "started", {
      recipientWallet: recipientWallet.trim(),
    });

    try {
      const payload = {
        recipient_wallet: recipientWallet.trim(),
        offer_items: offerItems.map((i) => ({
          ...i,
          product_name: i.product_name.trim(),
          quantity: i.quantity.trim(),
        })),
        request_items: requestItems.map((i) => ({
          ...i,
          product_name: i.product_name.trim(),
          quantity: i.quantity.trim(),
        })),
        expiry_hours: expiryHours,
        collateral_amount: includeCollateral ? collateralAmount.trim() : null,
        collateral_currency: includeCollateral ? collateralCurrency : null,
        notes: notes.trim() || null,
      };

      await new Promise((r) => setTimeout(r, 500));
      trackTransactionAttempt("barter", "confirmed", {
        recipientWallet: recipientWallet.trim(),
      });
      trackFunnelStep("barter_creation", "submitted", {
        includeCollateral,
      });
      await createBarterOffer(payload);
      await onSuccess();
      onClose();
    } catch (err) {
      trackTransactionAttempt("barter", "failed", {
        recipientWallet: recipientWallet.trim(),
      });
      setSaveError(
        err instanceof Error ? err.message : "Failed to submit barter offer.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="text-primary size-5" />
            Propose a Barter Trade
          </DialogTitle>
          <DialogDescription>
            Offer goods in exchange for other goods. Both parties must agree
            before the trade is finalised.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-6">
          <Input
            label="Recipient Wallet Address"
            value={recipientWallet}
            onChange={(e) => setRecipientWallet(e.target.value)}
            placeholder="G… or wallet address of the other party"
            error={errors.recipientWallet}
            required
          />

          <ItemFieldset
            label="You give"
            accent="primary"
            items={offerItems}
            onChange={setOfferItems}
            error={errors.offerItems}
          />

          <ItemFieldset
            label="You receive"
            accent="amber"
            items={requestItems}
            onChange={setRequestItems}
            error={errors.requestItems}
          />

          <div className="grid gap-1.5">
            <Label>Offer expires in</Label>
            <select
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
              value={expiryHours}
              onChange={(e) => setExpiryHours(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Checkbox
                id="include-collateral"
                checked={includeCollateral}
                onCheckedChange={(v) => setIncludeCollateral(Boolean(v))}
              />
              <Label
                htmlFor="include-collateral"
                className="text-sm font-medium"
              >
                Include collateral (if agreed)
              </Label>
            </div>

            {includeCollateral && (
              <div className="grid grid-cols-1 gap-3 pl-7 sm:grid-cols-2">
                <Input
                  label="Collateral amount"
                  type="number"
                  min={0}
                  step={0.01}
                  value={collateralAmount}
                  onChange={(e) => setCollateralAmount(e.target.value)}
                  placeholder="100"
                  error={errors.collateral}
                />
                <div className="grid gap-1.5">
                  <Label className="text-xs">Currency</Label>
                  <select
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
                    value={collateralCurrency}
                    onChange={(e) =>
                      setCollateralCurrency(
                        e.target.value as ProductCurrency,
                      )
                    }
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="barter-notes">Notes (optional, max 500)</Label>
            <Textarea
              id="barter-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional details about this trade…"
              maxLength={500}
            />
            {errors.notes && (
              <p className="text-destructive text-xs">{errors.notes}</p>
            )}
            <p className="text-muted-foreground text-right text-xs">
              {notes.length}/500
            </p>
          </div>

          {saveError && (
            <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border p-3 text-sm">
              {saveError}
            </div>
          )}

          <Separator />

          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={saving} disabled={saving}>
              Submit Offer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
