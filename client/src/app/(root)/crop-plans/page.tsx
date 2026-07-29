"use client";

import React, { useState, useEffect } from "react";
import Wrapper from "@/components/shared/wrapper";
import { Button } from "@/components/ui/button";
import { Calendar, Sprout, Bell, BarChart2, Plus } from "lucide-react";

interface CropPlan {
  id: string;
  farmerWallet: string;
  cropName: string;
  plantedDate: string;
  expectedHarvestStart: string;
  expectedHarvestEnd: string;
  expectedVolume?: number;
  unit?: string;
  region?: string;
  reminderDaysBefore: number;
  reminderSent: boolean;
}

interface AggregateSummary {
  cropName: string;
  totalExpectedVolume: number;
  unit: string;
  region: string | null;
  planCount: number;
}

export default function CropPlansPage() {
  const [plans, setPlans] = useState<CropPlan[]>([]);
  const [aggregates, setAggregates] = useState<AggregateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"my-plans" | "aggregate">("my-plans");

  // Form state
  const [farmerWallet, setFarmerWallet] = useState("");
  const [cropName, setCropName] = useState("");
  const [plantedDate, setPlantedDate] = useState("");
  const [expectedHarvestStart, setExpectedHarvestStart] = useState("");
  const [expectedHarvestEnd, setExpectedHarvestEnd] = useState("");
  const [expectedVolume, setExpectedVolume] = useState("");
  const [unit, setUnit] = useState("kg");
  const [region, setRegion] = useState("West");
  const [reminderDaysBefore, setReminderDaysBefore] = useState("7");
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

  const fetchPlans = async () => {
    try {
      const res = await fetch(`${API_BASE}/crop-plans`);
      if (res.ok) {
        const data = await res.json();
        setPlans(data);
      }
    } catch {
      // Backend offline or local fallback
    }
  };

  const fetchAggregates = async () => {
    try {
      const res = await fetch(`${API_BASE}/crop-plans/aggregate`);
      if (res.ok) {
        const data = await res.json();
        setAggregates(data.aggregates || []);
      }
    } catch {
      // Backend offline fallback
    }
  };

  useEffect(() => {
    fetchPlans();
    fetchAggregates();
  }, []);

  const handleSubmitPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!farmerWallet || !cropName || !plantedDate || !expectedHarvestStart || !expectedHarvestEnd) {
      setFormError("Please fill out all required fields.");
      return;
    }

    if (new Date(plantedDate) > new Date(expectedHarvestStart)) {
      setFormError("Planted date cannot be after expected harvest start date.");
      return;
    }

    if (new Date(expectedHarvestStart) > new Date(expectedHarvestEnd)) {
      setFormError("Expected harvest start date cannot be after harvest end date.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/crop-plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          farmerWallet,
          cropName,
          plantedDate,
          expectedHarvestStart,
          expectedHarvestEnd,
          expectedVolume: expectedVolume ? parseFloat(expectedVolume) : null,
          unit,
          region,
          reminderDaysBefore: parseInt(reminderDaysBefore, 10),
        }),
      });

      if (res.ok) {
        setFormSuccess("Crop plan successfully created!");
        setCropName("");
        setPlantedDate("");
        setExpectedHarvestStart("");
        setExpectedHarvestEnd("");
        setExpectedVolume("");
        fetchPlans();
        fetchAggregates();
      } else {
        const errData = await res.json();
        setFormError(errData.detail || "Failed to create crop plan");
      }
    } catch {
      setFormError("Network error. Could not connect to API server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pb-16 pt-28">
      <Wrapper>
        <div className="mb-8 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-primary font-medium text-sm">
            <Sprout className="size-4" />
            <span>Forward-Looking Production</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Harvest & Planting Calendar
          </h1>
          <p className="text-muted-foreground text-base max-w-2xl">
            Plan your crop cycles, set harvest reminder notifications, and share aggregate non-PII forecasts with regional buyers.
          </p>
        </div>

        {/* Tab Selection */}
        <div className="mb-8 flex gap-3 border-b border-border pb-3">
          <Button
            variant={activeTab === "my-plans" ? "default" : "outline"}
            onClick={() => setActiveTab("my-plans")}
            className="gap-2"
          >
            <Calendar className="size-4" />
            My Crop Plans
          </Button>
          <Button
            variant={activeTab === "aggregate" ? "default" : "outline"}
            onClick={() => setActiveTab("aggregate")}
            className="gap-2"
          >
            <BarChart2 className="size-4" />
            Regional Buyers Forecast
          </Button>
        </div>

        {activeTab === "my-plans" ? (
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Create Crop Plan Form */}
            <div className="lg:col-span-1 rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Plus className="size-5 text-primary" />
                Add New Crop Plan
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
              <form onSubmit={handleSubmitPlan} className="space-y-4 text-sm">
                <div>
                  <label className="block font-medium mb-1">Farmer Wallet Address *</label>
                  <input
                    type="text"
                    required
                    placeholder="G..."
                    value={farmerWallet}
                    onChange={(e) => setFarmerWallet(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Crop Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Cassava, Maize, Yam"
                    value={cropName}
                    onChange={(e) => setCropName(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Planted Date *</label>
                  <input
                    type="date"
                    required
                    value={plantedDate}
                    onChange={(e) => setPlantedDate(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium mb-1">Harvest Start *</label>
                    <input
                      type="date"
                      required
                      value={expectedHarvestStart}
                      onChange={(e) => setExpectedHarvestStart(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">Harvest End *</label>
                    <input
                      type="date"
                      required
                      value={expectedHarvestEnd}
                      onChange={(e) => setExpectedHarvestEnd(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium mb-1">Expected Volume</label>
                    <input
                      type="number"
                      placeholder="e.g. 500"
                      value={expectedVolume}
                      onChange={(e) => setExpectedVolume(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">Unit</label>
                    <input
                      type="text"
                      placeholder="kg / bags"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-medium mb-1">Region</label>
                  <input
                    type="text"
                    placeholder="Region or Zone"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1 flex items-center gap-1">
                    <Bell className="size-4 text-primary" />
                    Reminder Days Before Harvest
                  </label>
                  <input
                    type="number"
                    value={reminderDaysBefore}
                    onChange={(e) => setReminderDaysBefore(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full mt-2">
                  {loading ? "Creating..." : "Save Crop Plan"}
                </Button>
              </form>
            </div>

            {/* List of Existing Plans */}
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-xl font-semibold mb-4">Active Crop Cycles</h2>
              {plans.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
                  <Sprout className="size-10 mx-auto mb-2 opacity-50" />
                  <p>No active crop plans recorded yet.</p>
                  <p className="text-xs mt-1">Use the form on the left to add your first planting schedule.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {plans.map((p) => (
                    <div key={p.id} className="rounded-2xl border border-border bg-card p-5 space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-bold text-lg">{p.cropName}</h3>
                          <p className="text-xs text-muted-foreground">Region: {p.region || "Unspecified"}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
                          <Bell className="size-3" />
                          {p.reminderDaysBefore}d reminder
                        </span>
                      </div>
                      <div className="text-sm space-y-1 text-muted-foreground">
                        <p><span className="font-medium text-foreground">Planted:</span> {new Date(p.plantedDate).toLocaleDateString()}</p>
                        <p><span className="font-medium text-foreground">Expected Harvest:</span> {new Date(p.expectedHarvestStart).toLocaleDateString()} - {new Date(p.expectedHarvestEnd).toLocaleDateString()}</p>
                        {p.expectedVolume && (
                          <p><span className="font-medium text-foreground">Est. Volume:</span> {p.expectedVolume} {p.unit}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Aggregate Non-PII Forecast for Buyers */
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-xl font-semibold mb-2">Regional Aggregate Harvest Volume</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Read-only, non-PII summary of expected regional crop yields for prospective buyers and traders.
              </p>
              {aggregates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No regional forecast data available currently.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  {aggregates.map((agg, idx) => (
                    <div key={idx} className="rounded-xl border border-border p-4 bg-background">
                      <p className="text-xs font-semibold text-primary uppercase tracking-wider">{agg.region || "All Regions"}</p>
                      <h3 className="text-lg font-bold mt-1">{agg.cropName}</h3>
                      <p className="text-2xl font-black mt-2 text-foreground">
                        {agg.totalExpectedVolume.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">{agg.unit}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Based on {agg.planCount} farmer crop plan(s)
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Wrapper>
    </div>
  );
}
