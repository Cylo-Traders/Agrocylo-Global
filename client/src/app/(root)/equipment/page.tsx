"use client";

import React, { useState, useEffect } from "react";
import Wrapper from "@/components/shared/wrapper";
import { Button } from "@/components/ui/button";
import { Wrench, Sprout, ShieldCheck, RefreshCw, Plus } from "lucide-react";

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

export default function EquipmentPage() {
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [filterType, setFilterType] = useState<string>("ALL");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  // Create Listing Form
  const [ownerWallet, setOwnerWallet] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [listingType, setListingType] = useState<"SEED" | "TOOL" | "EQUIPMENT_RENTAL">("EQUIPMENT_RENTAL");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [depositAmount, setDepositAmount] = useState("0");
  const [currency, setCurrency] = useState("XLM");
  const [unit, setUnit] = useState("day");

  // Rental Form Modal State
  const [rentingListing, setRentingListing] = useState<EquipmentListing | null>(null);
  const [renterWallet, setRenterWallet] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Return Action State
  const [returningRentalId, setReturningRentalId] = useState<string | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

  const fetchListings = async () => {
    try {
      const url = filterType === "ALL" ? `${API_BASE}/equipment/listings` : `${API_BASE}/equipment/listings?listingType=${filterType}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setListings(data);
      }
    } catch {
      // API fallback
    }
  };

  useEffect(() => {
    fetchListings();
  }, [filterType]);

  const handleCreateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!ownerWallet || !title || !pricePerUnit) {
      setFormError("Owner Wallet, Title, and Price are required.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/equipment/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerWallet,
          title,
          description,
          listingType,
          pricePerUnit: parseFloat(pricePerUnit),
          depositAmount: parseFloat(depositAmount || "0"),
          currency,
          unit,
        }),
      });

      if (res.ok) {
        setFormSuccess("Listing created successfully!");
        setTitle("");
        setDescription("");
        setPricePerUnit("");
        setDepositAmount("0");
        fetchListings();
      } else {
        const err = await res.json();
        setFormError(err.detail || "Failed to create listing");
      }
    } catch {
      setFormError("Network error. Could not connect to backend server.");
    } finally {
      setLoading(false);
    }
  };

  const handleRentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rentingListing || !renterWallet || !startDate || !endDate) return;

    try {
      const res = await fetch(`${API_BASE}/equipment/rent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: rentingListing.id,
          renterWallet,
          startDate,
          endDate,
        }),
      });

      if (res.ok) {
        alert("Equipment rented successfully! Deposit held in escrow.");
        setRentingListing(null);
        setRenterWallet("");
        setStartDate("");
        setEndDate("");
        fetchListings();
      } else {
        const err = await res.json();
        alert(err.detail || "Rental request failed.");
      }
    } catch {
      alert("Network error.");
    }
  };

  const handleReturnEquipment = async (rentalId: string) => {
    try {
      const res = await fetch(`${API_BASE}/equipment/rentals/${rentalId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCondition: true }),
      });

      if (res.ok) {
        const data = await res.json();
        alert(data.message || "Equipment returned and deposit refunded!");
        fetchListings();
      } else {
        const err = await res.json();
        alert(err.detail || "Return action failed.");
      }
    } catch {
      alert("Network error.");
    }
  };

  return (
    <div className="min-h-screen pb-16 pt-28">
      <Wrapper>
        {/* Banner highlighting farmer-to-farmer non-edible marketplace */}
        <div className="mb-8 rounded-3xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-6 border border-amber-500/20">
          <div className="flex items-center gap-3 text-amber-600 font-semibold mb-2">
            <Wrench className="size-6" />
            <span className="text-lg">Farmer-to-Farmer Inputs & Equipment Marketplace</span>
          </div>
          <p className="text-sm text-muted-foreground max-w-3xl">
            This space is dedicated to seed, fertilizer, and machinery rentals between farmers. Rental listings feature deposit escrow with automated return & deposit refunds.
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap gap-2 mb-8">
          {["ALL", "EQUIPMENT_RENTAL", "SEED", "TOOL"].map((type) => (
            <Button
              key={type}
              variant={filterType === type ? "default" : "outline"}
              onClick={() => setFilterType(type)}
              className="capitalize text-xs md:text-sm"
            >
              {type === "ALL" ? "All Inputs & Equipment" : type.replace("_", " ")}
            </Button>
          ))}
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Create Listing Form */}
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
            <form onSubmit={handleCreateListing} className="space-y-4 text-sm">
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

          {/* Listings Feed */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-semibold mb-4">Available Inputs & Machinery</h2>
            {listings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
                <Wrench className="size-10 mx-auto mb-2 opacity-50" />
                <p>No listings found in this category.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {listings.map((l) => (
                  <div key={l.id} className="rounded-2xl border border-border bg-card p-5 space-y-3">
                    <div className="flex justify-between items-start">
                      <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600">
                        {l.listingType.replace("_", " ")}
                      </span>
                      <span className="text-lg font-black text-primary">
                        {l.pricePerUnit} {l.currency} <span className="text-xs font-normal text-muted-foreground">/ {l.unit}</span>
                      </span>
                    </div>
                    <h3 className="font-bold text-lg">{l.title}</h3>
                    {l.description && <p className="text-sm text-muted-foreground">{l.description}</p>}
                    
                    {Number(l.depositAmount) > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600 font-medium bg-amber-500/5 p-2 rounded-xl border border-amber-500/10">
                        <ShieldCheck className="size-4" />
                        <span>Refundable Deposit: {l.depositAmount} {l.currency}</span>
                      </div>
                    )}

                    {/* Active Rentals for this listing */}
                    {l.rentals && l.rentals.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground">Active Rentals:</p>
                        {l.rentals.map((r) => (
                          <div key={r.id} className="flex items-center justify-between text-xs bg-muted/40 p-2 rounded-lg">
                            <span>Status: {r.status}</span>
                            {r.status === "ACTIVE" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReturnEquipment(r.id)}
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

                    {l.listingType === "EQUIPMENT_RENTAL" && (
                      <Button
                        onClick={() => setRentingListing(l)}
                        className="w-full mt-2 text-xs"
                      >
                        Rent Machinery
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Rent Modal */}
        {rentingListing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl">
              <h3 className="text-xl font-bold mb-2">Rent {rentingListing.title}</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Deposit of {rentingListing.depositAmount} {rentingListing.currency} will be reserved during the rental period.
              </p>
              <form onSubmit={handleRentSubmit} className="space-y-4 text-sm">
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
                  <Button variant="ghost" type="button" onClick={() => setRentingListing(null)}>
                    Cancel
                  </Button>
                  <Button type="submit">Confirm Rental</Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </Wrapper>
    </div>
  );
}
