"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface LocationConsentProps {
  onComplete: (location: {
    latitude: number;
    longitude: number;
    city: string;
    country: string;
    isPublic: boolean;
  } | null) => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export default function LocationConsent({
  onComplete,
  onBack,
  isSubmitting,
}: LocationConsentProps) {
  const [mode, setMode] = useState<"ask" | "detecting" | "manual">("ask");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  function handleShareLocation() {
    if (!navigator.geolocation) {
      setMode("manual");
      return;
    }
    setMode("detecting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onComplete({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          city: "",
          country: "",
          isPublic,
        });
      },
      () => setMode("manual"),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  function handleManualSubmit() {
    if (!city.trim() || !country.trim()) return;
    // For manual entry, use 0,0 as coordinates — backend can geocode later
    onComplete({
      latitude: 0,
      longitude: 0,
      city: city.trim(),
      country: country.trim(),
      isPublic,
    });
  }

  if (mode === "ask") {
    return (
      <Card variant="elevated" padding="lg" className="max-w-md mx-auto">
        <h2 className="text-2xl font-bold text-foreground mb-2 text-center">
          Share Your Location
        </h2>

        <div className="rounded-lg bg-primary-50 border border-primary-200 p-4 mb-6">
          <p className="text-sm text-primary-800">
            Share your location so buyers and farmers can find you.
            <strong> Your exact coordinates are never shown publicly</strong> —
            only your city and approximate distance.
          </p>
        </div>

        <label className="flex items-center gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm text-foreground">
            Show my location on the map
          </span>
        </label>

        <div className="space-y-3">
          <Button
            variant="primary"
            fullWidth
            onClick={handleShareLocation}
            isLoading={isSubmitting}
          >
            Allow Location Access
          </Button>
          <Button
            variant="outline"
            fullWidth
            onClick={() => setMode("manual")}
          >
            Enter Manually Instead
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onClick={() => onComplete(null)}
            disabled={isSubmitting}
          >
            Skip for Now
          </Button>
        </div>

        <div className="mt-4">
          <Button variant="outline" fullWidth onClick={onBack}>
            Back
          </Button>
        </div>
      </Card>
    );
  }

  if (mode === "detecting") {
    return (
      <Card variant="elevated" padding="lg" className="max-w-md mx-auto text-center">
        <div className="animate-pulse">
          <div className="h-12 w-12 mx-auto rounded-full bg-primary-100 mb-4" />
          <p className="text-foreground font-medium">Detecting location...</p>
          <p className="text-sm text-muted mt-1">
            Please allow location access in your browser.
          </p>
        </div>
      </Card>
    );
  }

  // Manual entry
  return (
    <Card variant="elevated" padding="lg" className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-foreground mb-2 text-center">
        Enter Your Location
      </h2>
      <p className="text-muted text-sm mb-6 text-center">
        We&apos;ll use this to show your approximate area on the map.
      </p>

      <div className="space-y-4 mb-6">
        <Input
          label="City"
          placeholder="e.g. Lagos"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        <Input
          label="Country"
          placeholder="e.g. Nigeria"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        />

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm text-foreground">
            Show my location on the map
          </span>
        </label>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" fullWidth onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          fullWidth
          disabled={!city.trim() || !country.trim()}
          onClick={handleManualSubmit}
          isLoading={isSubmitting}
        >
          Save Location
        </Button>
      </div>
    </Card>
  );
}
