"use client";

import { useState, useEffect } from "react";

interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  error: string | null;
  isLoading: boolean;
  permissionGranted: boolean;
}

const LAGOS_LAT = 6.5244;
const LAGOS_LNG = 3.3792;

export function useGeolocation(opts: { walletAddress?: string | null } = {}) {
  const { walletAddress } = opts;
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    error: null,
    isLoading: true,
    permissionGranted: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function useSavedLocationFirst(): Promise<boolean> {
      if (!walletAddress) return false;
      try {
        const { getSavedLocation } = await import("@/services/profileService");
        const saved = await getSavedLocation();
        if (saved && !cancelled) {
          setState({
            latitude: saved.lat,
            longitude: saved.lng,
            error: null,
            isLoading: false,
            permissionGranted: true,
          });
          return true;
        }
      } catch {
        // Fall through to browser geolocation.
      }
      return false;
    }

    async function run() {
      if (await useSavedLocationFirst()) return;
      if (cancelled) return;
      if (!navigator.geolocation) {
        if (!cancelled) {
          setState({
            latitude: LAGOS_LAT,
            longitude: LAGOS_LNG,
            error: "Geolocation not supported",
            isLoading: false,
            permissionGranted: false,
          });
        }
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return;
          setState({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            error: null,
            isLoading: false,
            permissionGranted: true,
          });
        },
        () => {
          if (cancelled) return;
          setState({
            latitude: LAGOS_LAT,
            longitude: LAGOS_LNG,
            error: "Location permission denied — showing Lagos, Nigeria",
            isLoading: false,
            permissionGranted: false,
          });
        },
        { enableHighAccuracy: true, timeout: 10_000 }
      );
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return state;
}
