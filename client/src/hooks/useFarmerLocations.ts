"use client";

import { useState, useEffect, useCallback } from "react";
import { API_BASE_URL as API_BASE } from "@/lib/apiConfig";

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

interface FarmerLocationResponse {
  data?: FarmerLocation[];
  farmers?: FarmerLocation[];
}

interface UseFarmerLocationsOptions {
  latitude?: number | null;
  longitude?: number | null;
  radiusKm?: number | null;
}

export function useFarmerLocations(opts: UseFarmerLocationsOptions = {}) {
  const { latitude, longitude, radiusKm } = opts;
  const [farmers, setFarmers] = useState<FarmerLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFarmers = useCallback(async () => {
    // Don't query without coordinates - prevents returning all locations
    if (latitude == null || longitude == null) {
      setFarmers([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("lat", String(latitude));
      params.set("lng", String(longitude));
      if (radiusKm != null && radiusKm > 0) {
        params.set("radius", String(radiusKm));
      }
      const qs = params.toString();
      const url = `${API_BASE}/locations/farmers?${qs}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch farmers: ${res.status}`);
      const data = (await res.json()) as FarmerLocationResponse;
      setFarmers(data.farmers ?? data.data ?? []);
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
