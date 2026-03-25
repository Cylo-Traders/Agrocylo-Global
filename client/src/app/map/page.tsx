"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useFarmerLocations } from "@/hooks/useFarmerLocations";
import DistanceFilter from "@/components/map/DistanceFilter";
import MapSkeleton from "@/components/map/MapSkeleton";

const FarmerMap = dynamic(() => import("@/components/map/FarmerMap"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export default function MapPage() {
  const [radiusKm, setRadiusKm] = useState(50);
  const geo = useGeolocation();

  const { farmers, isLoading, error } = useFarmerLocations({
    latitude: geo.latitude,
    longitude: geo.longitude,
    radiusKm: radiusKm > 0 ? radiusKm : undefined,
  });

  return (
    <div className="relative flex h-[calc(100vh-56px)] flex-col">
      {/* Filter bar */}
      <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2">
        <DistanceFilter selected={radiusKm} onChange={setRadiusKm} />
      </div>

      {/* Status overlay */}
      {!geo.isLoading && geo.error && (
        <div className="absolute top-20 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-secondary-100 px-4 py-2 text-sm text-secondary-800 shadow">
          {geo.error}
        </div>
      )}

      {error && (
        <div className="absolute top-20 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-red-100 px-4 py-2 text-sm text-red-800 shadow">
          {error}
        </div>
      )}

      {/* Farmer count */}
      {!isLoading && !geo.isLoading && (
        <div className="absolute bottom-4 left-4 z-10 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-neutral-700 shadow backdrop-blur-sm">
          {farmers.length === 0
            ? "No farmers found in this area"
            : `${farmers.length} farmer${farmers.length === 1 ? "" : "s"} nearby`}
        </div>
      )}

      {/* Map */}
      <div className="flex-1">
        {geo.isLoading ? (
          <MapSkeleton />
        ) : (
          <FarmerMap
            farmers={farmers}
            userLat={geo.latitude!}
            userLng={geo.longitude!}
            radiusKm={radiusKm}
          />
        )}
      </div>
    </div>
  );
}
