"use client";

import { useState, useRef, useEffect } from "react";
import { MapPin, Loader2, AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAnalytics } from "@/hooks/useAnalytics";

type LocationState =
  | "idle"
  | "requesting_location"
  | "reverse_geocoding"
  | "success"
  | "error"
  | "manual_fallback";

interface LocationConsentProps {
  onComplete: (
    location: {
      latitude: number;
      longitude: number;
      city: string;
      country: string;
      isPublic: boolean;
    } | null,
  ) => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export default function LocationConsent({
  onComplete,
  onBack,
  isSubmitting,
}: LocationConsentProps) {
  const { trackFeatureAdoption, trackFunnelStep } = useAnalytics();
  const [state, setState] = useState<LocationState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [manualError, setManualError] = useState("");
  const [isGeocodingManual, setIsGeocodingManual] = useState(false);
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function handleShareLocation() {
    if (!navigator.geolocation) {
      setErrorMsg("Geolocation is not supported by your browser");
      setState("error");
      trackFunnelStep("onboarding_completion", "location_unavailable");
      return;
    }

    setState("requesting_location");
    trackFunnelStep("onboarding_completion", "location_request_started", {
      isPublic,
    });

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setState("reverse_geocoding");
        try {
          abortControllerRef.current = new AbortController();
          const timeoutId = setTimeout(
            () => abortControllerRef.current?.abort(),
            10000,
          );

          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
            { signal: abortControllerRef.current.signal },
          );

          clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`Fetch failed with status ${res.status}`);
          }

          const data = await res.json();
          const detectedCity =
            data.address?.city ||
            data.address?.town ||
            data.address?.village ||
            "";
          const detectedCountry = data.address?.country || "";

          setState("success");
          trackFunnelStep("onboarding_completion", "location_shared", {
            city: detectedCity || "unknown",
            country: detectedCountry || "unknown",
            isPublic,
          });
          onComplete({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            city: detectedCity,
            country: detectedCountry,
            isPublic,
          });
        } catch (err: unknown) {
          console.error("Reverse geocoding failed", err);
          if (err instanceof Error && err.name === "AbortError") {
            setErrorMsg("Request timed out");
          } else {
            setErrorMsg("Failed to detect city/country automatically");
          }
          setState("error");
          trackFunnelStep("onboarding_completion", "location_lookup_failed", {
            reason: err instanceof Error ? err.name : "unknown",
          });
        }
      },
      (err) => {
        console.error("Geolocation failed", err);
        setErrorMsg(err.message || "Permission denied or location unavailable");
        setState("error");
        trackFunnelStep("onboarding_completion", "location_permission_denied", {
          reason: err.message || "unknown",
        });
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function handleManualSubmit() {
    const trimmedCity = city.trim();
    const trimmedCountry = country.trim();
    if (!trimmedCity || !trimmedCountry) return;

    // Manual entry only provides place names, so resolve them to real
    // coordinates before submitting. Sending a placeholder like (0, 0) would
    // be rejected by the API (Issue #1111).
    setIsGeocodingManual(true);
    setManualError("");
    try {
      abortControllerRef.current = new AbortController();
      const timeoutId = setTimeout(
        () => abortControllerRef.current?.abort(),
        10000,
      );
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&city=${encodeURIComponent(
          trimmedCity,
        )}&country=${encodeURIComponent(trimmedCountry)}`,
        { signal: abortControllerRef.current.signal },
      );
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Fetch failed with status ${res.status}`);
      }

      const results = (await res.json()) as Array<{ lat: string; lon: string }>;
      const match = results[0];
      const latitude = match ? Number.parseFloat(match.lat) : NaN;
      const longitude = match ? Number.parseFloat(match.lon) : NaN;

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        (latitude === 0 && longitude === 0)
      ) {
        setManualError(
          "We couldn't find that location. Please check the city and country and try again.",
        );
        trackFunnelStep("onboarding_completion", "location_manual_lookup_failed", {
          reason: "not_found",
        });
        return;
      }

      trackFeatureAdoption("manual_location_entry", { city, country });
      trackFunnelStep("onboarding_completion", "location_entered_manually", {
        isPublic,
      });
      onComplete({
        latitude,
        longitude,
        city: trimmedCity,
        country: trimmedCountry,
        isPublic,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setManualError("Looking up your location timed out. Please try again.");
      } else {
        setManualError(
          "We couldn't look up that location. Please try again.",
        );
      }
      trackFunnelStep("onboarding_completion", "location_manual_lookup_failed", {
        reason: err instanceof Error ? err.name : "unknown",
      });
    } finally {
      setIsGeocodingManual(false);
    }
  }

  if (state === "idle") {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Share Your Location</CardTitle>
          <CardDescription>
            Help buyers and farmers find you nearby.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-primary/5 border-primary/20 rounded-2xl border p-4">
            <p className="text-sm">
              Share your location so buyers and farmers can find you.{" "}
              <strong>Your exact coordinates are never shown publicly</strong>{" "}
              - only your city and approximate distance.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="loc-public"
              checked={isPublic}
              onCheckedChange={(v) => setIsPublic(Boolean(v))}
            />
            <Label htmlFor="loc-public" className="cursor-pointer">
              Show my location on the map
            </Label>
          </div>

          <div className="space-y-2">
            <Button
              onClick={handleShareLocation}
              isLoading={isSubmitting}
              className="w-full"
            >
              <MapPin className="mr-2 size-4" />
              Allow Location Access
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                trackFunnelStep("onboarding_completion", "location_manual_selected");
                setState("manual_fallback");
              }}
              className="w-full"
            >
              Enter Manually Instead
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                trackFunnelStep("onboarding_completion", "location_skipped");
                onComplete(null);
              }}
              disabled={isSubmitting}
              className="w-full"
            >
              Skip for Now
            </Button>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              trackFunnelStep("onboarding_completion", "location_step_back");
              onBack();
            }}
            className="w-full"
          >
            Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (
    state === "requesting_location" ||
    state === "reverse_geocoding" ||
    state === "success"
  ) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 className="text-primary size-10 animate-spin" />
          <p className="font-medium">
            {state === "requesting_location"
              ? "Detecting your location..."
              : "Processing location data..."}
          </p>
          <p className="text-muted-foreground text-sm">
            {state === "requesting_location"
              ? "Please allow location access in your browser."
              : "Just a moment."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <AlertCircle className="text-destructive size-10" />
          <div className="space-y-1">
            <p className="font-medium text-destructive">Location Error</p>
            <p className="text-muted-foreground text-sm">{errorMsg}</p>
          </div>
          <div className="flex w-full flex-col gap-2 pt-4">
            <Button onClick={handleShareLocation} className="w-full">
              Retry location detection
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                trackFunnelStep("onboarding_completion", "location_manual_retry");
                setState("manual_fallback");
              }}
              className="w-full"
            >
              Enter your location manually
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Enter Your Location</CardTitle>
        <CardDescription>
          We&apos;ll show your approximate area on the map.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="city-input">City</Label>
            <Input
              id="city-input"
              type="text"
              placeholder="e.g. Lagos"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country-input">Country</Label>
            <Input
              id="country-input"
              type="text"
              placeholder="e.g. Nigeria"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </div>

          {manualError && (
            <p className="text-destructive text-sm" role="alert">
              {manualError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Checkbox
              id="loc-manual-public"
              checked={isPublic}
              onCheckedChange={(v) => setIsPublic(Boolean(v))}
            />
            <Label htmlFor="loc-manual-public" className="cursor-pointer">
              Show my location on the map
            </Label>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => {
              trackFunnelStep("onboarding_completion", "location_manual_back");
              setState("idle");
            }}
            className="flex-1"
          >
            Back
          </Button>
          <Button
            disabled={!city.trim() || !country.trim()}
            onClick={handleManualSubmit}
            isLoading={isSubmitting || isGeocodingManual}
            className="flex-[2]"
          >
            Save Location
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

