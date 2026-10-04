"use client";

import { Button } from "@/components/ui/button";
import { ShieldCheck, RefreshCw } from "lucide-react";

interface EquipmentRental {
  id: string;
  listingId: string;
  renterWallet: string;
  startDate: string;
  endDate: string;
  status: string;
  depositAmount: string | number;
  depositRefunded: boolean;
}

interface EquipmentListing {
  id: string;
  ownerWallet: string;
  title: string;
  description?: string;
  listingType: "SEED" | "TOOL" | "EQUIPMENT_RENTAL";
  pricePerUnit: string | number;
  depositAmount: string | number;
  currency: string;
  unit: string;
  location?: string;
  isAvailable: boolean;
  rentals?: EquipmentRental[];
}

interface EquipmentListingCardProps {
  listing: EquipmentListing;
  onRent: (listing: EquipmentListing) => void;
  onReturn: (rentalId: string) => void;
}

export function EquipmentListingCard({ listing, onRent, onReturn }: EquipmentListingCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex justify-between items-start">
        <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600">
          {listing.listingType.replace("_", " ")}
        </span>
        <span className="text-lg font-black text-primary">
          {listing.pricePerUnit} {listing.currency} <span className="text-xs font-normal text-muted-foreground">/ {listing.unit}</span>
        </span>
      </div>
      <h3 className="font-bold text-lg">{listing.title}</h3>
      {listing.description && <p className="text-sm text-muted-foreground">{listing.description}</p>}
      
      {Number(listing.depositAmount) > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 font-medium bg-amber-500/5 p-2 rounded-xl border border-amber-500/10">
          <ShieldCheck className="size-4" />
          <span>Refundable Deposit: {listing.depositAmount} {listing.currency}</span>
        </div>
      )}

      {listing.rentals && listing.rentals.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Active Rentals:</p>
          {listing.rentals.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-xs bg-muted/40 p-2 rounded-lg">
              <span>Status: {r.status}</span>
              {r.status === "ACTIVE" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onReturn(r.id)}
                  className="h-7 text-xs gap-1"
                >
                  <RefreshCw className="size-3" />
                  Return & Refund
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {listing.listingType === "EQUIPMENT_RENTAL" && (
        <Button
          onClick={() => onRent(listing)}
          className="w-full mt-2 text-xs"
        >
          Rent Machinery
        </Button>
      )}
    </div>
  );
}
