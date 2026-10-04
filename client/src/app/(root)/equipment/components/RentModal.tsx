"use client";

import { Button } from "@/components/ui/button";

interface EquipmentListing {
  id: string;
  title: string;
  depositAmount: string | number;
  currency: string;
}

interface RentModalProps {
  listing: EquipmentListing | null;
  renterWallet: string;
  setRenterWallet: (val: string) => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function RentModal({
  listing,
  renterWallet,
  setRenterWallet,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  onSubmit,
  onClose,
}: RentModalProps) {
  if (!listing) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl">
        <h3 className="text-xl font-bold mb-2">Rent {listing.title}</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Deposit of {listing.depositAmount} {listing.currency} will be reserved during the rental period.
        </p>
        <form onSubmit={onSubmit} className="space-y-4 text-sm">
          <div>
            <label className="block font-medium mb-1">Your Renter Wallet *</label>
            <input
              type="text"
              required
              placeholder="G..."
              value={renterWallet}
              onChange={(e) => setRenterWallet(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-medium mb-1">Start Date *</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">End Date *</label>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Confirm Rental</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
