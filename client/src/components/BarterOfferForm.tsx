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
import {
  sanitizeString,
  validateStellarAddress,
  validateRequired,
  validatePositiveNumber,
  validateMaxLength,
} from "@/lib/validation";
import { trackEvent } from "@/lib/analytics";

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
    <div className="space-y-3" role="group" aria-label={label}>
      <div className="flex items-center justify-between">
        <Text variant="body" className="font-semibold text-sm">
          {label}
        </Text>
        <Button
          type="button"
          variant="outline"
          onClick={addItem}
          className="text-xs px-3 py-1"
          aria-label={`Add item to ${label}`}
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
          role="group"
          aria-label={`${label} item ${idx + 1}`}
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
                aria-label={`Remove item ${idx + 1} from ${label}`}
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
            maxLength={200}
          />

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label id={`cat-${label}-${idx}`} className="text-xs font-medium text-foreground">
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
                aria-labelledby={`cat-${label}-${idx}`}
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
              <label id={`unit-${label}-${idx}`} className="text-xs font-medium text-foreground">Unit</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={item.unit}
                onChange={(e) =>
                  updateItem(idx, { unit: e.target.value as ProductUnit })
                }
                aria-labelledby={`unit-${label}-${idx}`}
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
        <Text variant="body" className="text-error text-sm" role="alert">
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

    const addrError = validateStellarAddress(recipientWallet);
    if (addrError) {
      next.recipientWallet = addrError;
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
      const collError = validatePositiveNumber(collateralAmount, "Collateral amount");
      if (collError) next.collateral = collError;
    }

    const notesError = validateMaxLength(notes, 500, "Notes");
    if (notesError) next.notes = notesError;

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
      const _payload = {
        proposer_wallet: walletAddress,
        recipient_wallet: sanitizeString(recipientWallet),
        offer_items: offerItems.map((i) => ({
          ...i,
          product_name: sanitizeString(i.product_name),
          quantity: i.quantity.trim(),
        })),
        request_items: requestItems.map((i) => ({
          ...i,
          product_name: sanitizeString(i.product_name),
          quantity: i.quantity.trim(),
        })),
        expiry_hours: expiryHours,
        collateral_amount: includeCollateral ? collateralAmount.trim() : null,
        collateral_currency: includeCollateral ? collateralCurrency : null,
        notes: sanitizeString(notes) || null,
      };

      await new Promise((r) => setTimeout(r, 500));

      trackEvent("barter_offer_created");

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="barter-form-title"
    >
      <div className="w-full max-w-2xl my-8">
        <Card variant="elevated" padding="lg">
          <CardHeader>
            <CardTitle id="barter-form-title">Propose a Barter Trade</CardTitle>
            <Text variant="body" muted className="text-sm mt-1">
              Offer goods in exchange for other goods. Both parties must agree
              before the trade is finalized.
            </Text>
          </CardHeader>

          <form onSubmit={onSubmit} noValidate>
            <CardContent className="space-y-6">
              <Input
                label="Recipient Wallet Address"
                value={recipientWallet}
                onChange={(e) => setRecipientWallet(e.target.value)}
                placeholder="G... or wallet address of the other party"
                error={errors.recipientWallet}
                required
                maxLength={56}
              />

              <div className="border-l-4 border-primary-500 pl-4">
                <ItemFieldset
                  label="You Give"
                  items={offerItems}
                  onChange={setOfferItems}
                  error={errors.offerItems}
                />
              </div>

              <div className="border-l-4 border-accent-500 pl-4">
                <ItemFieldset
                  label="You Receive"
                  items={requestItems}
                  onChange={setRequestItems}
                  error={errors.requestItems}
                />
              </div>

              <div className="space-y-2">
                <label id="expiry-label" className="text-sm font-medium text-foreground">
                  Offer Expires In
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(Number(e.target.value))}
                  aria-labelledby="expiry-label"
                >
                  {EXPIRY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeCollateral}
                    onChange={(e) => setIncludeCollateral(e.target.checked)}
                    aria-label="Include collateral"
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
                      <label id="coll-currency-label" className="text-xs font-medium text-foreground">
                        Currency
                      </label>
                      <select
                        className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"
                        value={collateralCurrency}
                        onChange={(e) =>
                          setCollateralCurrency(e.target.value as ProductCurrency)
                        }
                        aria-labelledby="coll-currency-label"
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

              <div className="space-y-2">
                <label htmlFor="barter-notes" className="text-sm font-medium text-foreground">
                  Notes (optional, max 500 chars)
                </label>
                <textarea
                  id="barter-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional details about this trade..."
                  className={[
                    "w-full rounded-lg border bg-background px-4 py-2.5 text-foreground text-base transition-colors placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-20",
                    errors.notes
                      ? "border-error focus:ring-error"
                      : "border-border",
                  ].join(" ")}
                  maxLength={500}
                  aria-invalid={!!errors.notes}
                />
                {errors.notes && (
                  <Text variant="body" className="text-error text-sm" role="alert">
                    {errors.notes}
                  </Text>
                )}
                <Text variant="body" muted className="text-xs">
                  {notes.length}/500
                </Text>
              </div>

              {saveError && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3" role="alert">
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
