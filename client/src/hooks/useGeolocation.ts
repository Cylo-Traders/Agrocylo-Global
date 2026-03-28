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

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    error: null,
    isLoading: true,
    permissionGranted: false,
  });

  useEffect(() => {
    if (!navigator.geolocation) {
      setState({
        latitude: LAGOS_LAT,
        longitude: LAGOS_LNG,
        error: "Geolocation not supported",
        isLoading: false,
        permissionGranted: false,
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          error: null,
          isLoading: false,
          permissionGranted: true,
        });
      },
      () => {
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
  }, []);

  return state;
}
