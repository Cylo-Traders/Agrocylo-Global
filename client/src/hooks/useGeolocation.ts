"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GeolocationSource = "saved" | "browser" | "fallback" | "idle";

interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  error: string | null;
  isLoading: boolean;
  isRequesting: boolean;
  permissionGranted: boolean;
  source: GeolocationSource;
}

const LAGOS_LAT = 6.5244;
const LAGOS_LNG = 3.3792;

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 5 * 60 * 1000,
};

function fallbackState(error: string | null): GeolocationState {
  return {
    latitude: LAGOS_LAT,
    longitude: LAGOS_LNG,
    error,
    isLoading: false,
    isRequesting: false,
    permissionGranted: false,
    source: "fallback",
  };
}

function describeGeolocationError(code: number): string {
  switch (code) {
    case 1:
      return "Location permission denied — showing Lagos, Nigeria";
    case 2:
      return "Location unavailable — showing Lagos, Nigeria";
    case 3:
      return "Location request timed out — showing Lagos, Nigeria";
    default:
      return "Could not get your location — showing Lagos, Nigeria";
  }
}

export function useGeolocation(opts: { walletAddress?: string | null } = {}) {
  const { walletAddress } = opts;
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    error: null,
    isLoading: true,
    isRequesting: false,
    permissionGranted: false,
    source: "idle",
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyState = useCallback((next: GeolocationState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      applyState(fallbackState("Geolocation not supported"));
      return;
    }

    setState((prev) => ({
      ...prev,
      error: null,
      isRequesting: true,
    }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyState({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          error: null,
          isLoading: false,
          isRequesting: false,
          permissionGranted: true,
          source: "browser",
        });
      },
      (err) => {
        applyState(fallbackState(describeGeolocationError(err.code)));
      },
      GEOLOCATION_OPTIONS,
    );
  }, [applyState]);

  useEffect(() => {
    let cancelled = false;

    async function resolveSavedLocation(): Promise<boolean> {
      if (!walletAddress) return false;
      try {
        const { getSavedLocation } = await import("@/services/profileService");
        const saved = await getSavedLocation();
        if (saved && !cancelled) {
          applyState({
            latitude: saved.lat,
            longitude: saved.lng,
            error: null,
            isLoading: false,
            isRequesting: false,
            permissionGranted: true,
            source: "saved",
          });
          return true;
        }
      } catch {
        // Fall through to the non-located default.
      }
      return false;
    }

    async function run() {
      // Reuse the user's saved location whenever possible; otherwise start
      // from a known default WITHOUT triggering the browser permission
      // prompt (Issue #1110). Precise location is only requested when the
      // user explicitly opts in via `requestLocation()`.
      if (await resolveSavedLocation()) return;
      if (cancelled) return;
      applyState(fallbackState(null));
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, applyState]);

  return { ...state, requestLocation };
}
