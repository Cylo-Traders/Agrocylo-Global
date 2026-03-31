"use client";

import React, { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Text,
} from "@/components/ui";
import type {
  ProductCategory,
  ProductUnit,
  ProductCurrency,
} from "@/types/product";
import type { BarterOfferItem } from "@/types/barter";

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
    | "recipientWallet"
    | "offerItems"
    | "requestItems"
    | "expiryHours"
    | "collateral"
    | "notes",
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

function ItemFieldset({
  label,
  items,
  onChange,
  error,
}: {
  label: string;
  items: BarterOfferItem[];
  onChange: (items: BarterOfferItem[]) => void;
  error?: string;
}) {
  function updateItem(idx: number, patch: Partial<BarterOfferItem>) {
    const next = items.map((item, i) => (i === idx ? { ...item, ...patch } : item));
    onChange(next);
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function addItem() {
    onChange([...items, emptyItem()]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Text variant="body" className="font-semibold text-sm">
          {label}
        </Text>
        <Button
          type="button"
          variant="outline"
          onClick={addItem}
          className="text-xs px-3 py-1"
        >
          + Add item
        </Button>
      </div>

      {items.length === 0 && (
        <div className="border border-dashed border-border rounded-lg p-4 text-center">
          <Text variant="body" muted className="text-sm">
            No items added yet. Click &quot;+ Add item&quot; to start.
          </Text>
        </div>
      )}

      {items.map((item, idx) => (
        <div
          key={idx}
          className="border border-border rounded-lg p-3 space-y-3 bg-surface"
        >
          <div className="flex items-center justify-between">
            <Text variant="body" muted className="text-xs font-medium">
              Item {idx + 1}
            </Text>
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => removeItem(idx)}
                className="text-error text-xs hover:underline"
              >
                Remove
              </button>
            )}
          </div>

          <Input
            label="Product name"
            value={item.product_name}
            onChange={(e) => updateItem(idx, { product_name: e.target.value })}
            placeholder="e.g. Organic Tomatoes"
            required
          />

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Category
              </label>
              <select
                className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={item.category}
                onChange={(e) =>
                  updateItem(idx, {
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

            <div className="space-y-1">
              <Input
                label="Quantity"
                type="number"
                value={item.quantity}
                min={0}
                step={0.1}
                onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                placeholder="e.g. 50"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Unit</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={item.unit}
                onChange={(e) =>
                  updateItem(idx, { unit: e.target.value as ProductUnit })
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

      {error && (
        <Text variant="body" className="text-error text-sm">
          {error}
        </Text>
      )}
    </div>
  );
}

export default function BarterOfferForm({
  open,
  walletAddress,
  onClose,
  onSuccess,
}: {
  open: boolean;
  walletAddress: string;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const [recipientWallet, setRecipientWallet] = useState("");
  const [offerItems, setOfferItems] = useState<BarterOfferItem[]>([emptyItem()]);
  const [requestItems, setRequestItems] = useState<BarterOfferItem[]>([emptyItem()]);
  const [expiryHours, setExpiryHours] = useState(24);
  const [includeCollateral, setIncludeCollateral] = useState(false);
  const [collateralAmount, setCollateralAmount] = useState("");
  const [collateralCurrency, setCollateralCurrency] = useState<ProductCurrency>("STRK");
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
    } else if (offerItems.some((i) => !i.product_name.trim() || !i.quantity || Number(i.quantity) <= 0)) {
      next.offerItems = "All offer items must have a name and positive quantity.";
    }

    if (requestItems.length === 0) {
      next.requestItems = "Add at least one item you want to receive.";
    } else if (requestItems.some((i) => !i.product_name.trim() || !i.quantity || Number(i.quantity) <= 0)) {
      next.requestItems = "All request items must have a name and positive quantity.";
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

    try {
      // TODO: integrate with barterService once backend endpoint is available
      const _payload = {
        proposer_wallet: walletAddress,
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

      // Placeholder: when backend is ready, replace with:
      // await createBarterOffer(walletAddress, payload);
      await new Promise((r) => setTimeout(r, 500));

      await onSuccess();
      onClose();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to submit barter offer."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl my-8">
        <Card variant="elevated" padding="lg">
          <CardHeader>
            <CardTitle>Propose a Barter Trade</CardTitle>
            <Text variant="body" muted className="text-sm mt-1">
              Offer goods in exchange for other goods. Both parties must agree
              before the trade is finalized.
            </Text>
          </CardHeader>

          <form onSubmit={onSubmit}>
            <CardContent className="space-y-6">
              {/* Recipient */}
              <Input
                label="Recipient Wallet Address"
                value={recipientWallet}
                onChange={(e) => setRecipientWallet(e.target.value)}
                placeholder="G... or wallet address of the other party"
                error={errors.recipientWallet}
                required
              />

              {/* You Give */}
              <div className="border-l-4 border-primary-500 pl-4">
                <ItemFieldset
                  label="You Give"
                  items={offerItems}
                  onChange={setOfferItems}
                  error={errors.offerItems}
                />
              </div>

              {/* You Receive */}
              <div className="border-l-4 border-accent-500 pl-4">
                <ItemFieldset
                  label="You Receive"
                  items={requestItems}
                  onChange={setRequestItems}
                  error={errors.requestItems}
                />
              </div>

              {/* Expiry Window */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Offer Expires In
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
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

              {/* Collateral (optional) */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeCollateral}
                    onChange={(e) => setIncludeCollateral(e.target.checked)}
                  />
                  <Text variant="body" className="font-medium text-sm">
                    Include collateral (if agreed)
                  </Text>
                </label>

                {includeCollateral && (
                  <div className="grid grid-cols-2 gap-3 pl-7">
                    <Input
                      label="Collateral Amount"
                      type="number"
                      value={collateralAmount}
                      min={0}
                      step={0.01}
                      onChange={(e) => setCollateralAmount(e.target.value)}
                      placeholder="e.g. 100"
                      error={errors.collateral}
                    />
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        Currency
                      </label>
                      <select
                        className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"
                        value={collateralCurrency}
                        onChange={(e) =>
                          setCollateralCurrency(e.target.value as ProductCurrency)
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

              {/* Notes */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Notes (optional, max 500 chars)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional details about this trade..."
                  className={[
                    "w-full rounded-lg border bg-background px-4 py-2.5 text-foreground text-base transition-colors placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-20",
                    errors.notes
                      ? "border-error focus:ring-error"
                      : "border-border",
                  ].join(" ")}
                />
                {errors.notes && (
                  <Text variant="body" className="text-error text-sm">
                    {errors.notes}
                  </Text>
                )}
                <Text variant="body" muted className="text-xs">
                  {notes.length}/500
                </Text>
              </div>

              {/* Error banner */}
              {saveError && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3">
                  <Text variant="body" className="text-error">
                    {saveError}
                  </Text>
                </div>
              )}
            </CardContent>

            <CardFooter className="flex gap-3 justify-end">
              <Button
                variant="outline"
                type="button"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? "Submitting..." : "Submit Offer"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
