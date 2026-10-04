"use client";

import { Button } from "@/components/ui/button";
import { Plus, ShieldCheck } from "lucide-react";

interface CreateListingFormProps {
  ownerWallet: string;
  setOwnerWallet: (val: string) => void;
  title: string;
  setTitle: (val: string) => void;
  description: string;
  setDescription: (val: string) => void;
  listingType: "SEED" | "TOOL" | "EQUIPMENT_RENTAL";
  setListingType: (val: "SEED" | "TOOL" | "EQUIPMENT_RENTAL") => void;
  pricePerUnit: string;
  setPricePerUnit: (val: string) => void;
  depositAmount: string;
  setDepositAmount: (val: string) => void;
  currency: string;
  unit: string;
  setUnit: (val: string) => void;
  loading: boolean;
  formError: string;
  formSuccess: string;
  onSubmit: (e: React.FormEvent) => void;
}

export function CreateListingForm({
  ownerWallet,
  setOwnerWallet,
  title,
  setTitle,
  description,
  setDescription,
  listingType,
  setListingType,
  pricePerUnit,
  setPricePerUnit,
  depositAmount,
  setDepositAmount,
  currency,
  unit,
  setUnit,
  loading,
  formError,
  formSuccess,
  onSubmit,
}: CreateListingFormProps) {
  return (
    <div className="lg:col-span-1 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Plus className="size-5 text-primary" />
        New Equipment / Seed Listing
      </h2>
      {formError && (
        <div className="mb-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive font-medium">
          {formError}
        </div>
      )}
      {formSuccess && (
        <div className="mb-4 rounded-xl bg-primary/10 p-3 text-sm text-primary font-medium">
          {formSuccess}
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4 text-sm">
        <div>
          <label className="block font-medium mb-1">Owner Wallet Address *</label>
          <input
            type="text"
            required
            placeholder="G..."
            value={ownerWallet}
            onChange={(e) => setOwnerWallet(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block font-medium mb-1">Title *</label>
          <input
            type="text"
            required
            placeholder="e.g. Tractor Rental / Hybrid Seeds"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block font-medium mb-1">Category / Listing Type</label>
          <select
            value={listingType}
            onChange={(e) => setListingType(e.target.value as any)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="EQUIPMENT_RENTAL">Equipment Rental</option>
            <option value="SEED">Seeds & Fertilizer</option>
            <option value="TOOL">Tools & Implements</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-medium mb-1">Price per Unit *</label>
            <input
              type="number"
              step="0.01"
              required
              placeholder="50"
              value={pricePerUnit}
              onChange={(e) => setPricePerUnit(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Unit</label>
            <input
              type="text"
              required
              placeholder="day / kg"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        {listingType === "EQUIPMENT_RENTAL" && (
          <div>
            <label className="block font-medium mb-1 flex items-center gap-1">
              <ShieldCheck className="size-4 text-amber-500" />
              Refundable Deposit Amount
            </label>
            <input
              type="number"
              step="0.01"
              placeholder="100"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        )}
        <Button type="submit" disabled={loading} className="w-full mt-2">
          {loading ? "Publishing..." : "Publish Listing"}
        </Button>
      </form>
    </div>
  );
}
