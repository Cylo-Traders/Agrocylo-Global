"use client";

import { useState, useEffect, useCallback } from "react";

export interface FarmerLocation {
  wallet_address: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
  country: string | null;
  distance_km?: number;
}

interface UseFarmerLocationsOptions {
  latitude?: number | null;
  longitude?: number | null;
  radiusKm?: number | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

export function useFarmerLocations(opts: UseFarmerLocationsOptions = {}) {
  const { latitude, longitude, radiusKm } = opts;
  const [farmers, setFarmers] = useState<FarmerLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFarmers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (latitude != null && longitude != null) {
        params.set("lat", String(latitude));
        params.set("lng", String(longitude));
      }
      if (radiusKm != null && radiusKm > 0) {
        params.set("radius", String(radiusKm));
      }
      const qs = params.toString();
      const url = `${API_BASE}/locations/farmers${qs ? `?${qs}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch farmers: ${res.status}`);
      const data = await res.json();
      setFarmers(data.farmers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFarmers([]);
    } finally {
      setIsLoading(false);
    }
  }, [latitude, longitude, radiusKm]);

  useEffect(() => {
    fetchFarmers();
  }, [fetchFarmers]);

  return { farmers, isLoading, error, refetch: fetchFarmers };
}
