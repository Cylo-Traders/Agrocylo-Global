"use client";

import React, { useState, useEffect } from "react";
import Wrapper from "@/components/shared/wrapper";
import { Button } from "@/components/ui/button";
import { Wrench } from "lucide-react";
import { CreateListingForm } from "./components/CreateListingForm";
import { EquipmentListingCard } from "./components/EquipmentListingCard";
import { RentModal } from "./components/RentModal";

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
          <CreateListingForm
            ownerWallet={ownerWallet}
            setOwnerWallet={setOwnerWallet}
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            listingType={listingType}
            setListingType={setListingType}
            pricePerUnit={pricePerUnit}
            setPricePerUnit={setPricePerUnit}
            depositAmount={depositAmount}
            setDepositAmount={setDepositAmount}
            currency={currency}
            unit={unit}
            setUnit={setUnit}
            loading={loading}
            formError={formError}
            formSuccess={formSuccess}
            onSubmit={handleCreateListing}
          />

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
                  <EquipmentListingCard
                    key={l.id}
                    listing={l}
                    onRent={setRentingListing}
                    onReturn={handleReturnEquipment}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <RentModal
          listing={rentingListing}
          renterWallet={renterWallet}
          setRenterWallet={setRenterWallet}
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          onSubmit={handleRentSubmit}
          onClose={() => setRentingListing(null)}
        />
      </Wrapper>
    </div>
  );
}
