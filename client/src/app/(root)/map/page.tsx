"use client";

import { useState, Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Users, AlertTriangle, MapPin } from "lucide-react";

import { useWallet } from "@/hooks/useWallet";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useFarmerLocations } from "@/hooks/useFarmerLocations";
import DistanceFilter from "@/components/map/DistanceFilter";
import MapSkeleton from "@/components/map/MapSkeleton";

interface MapErrorBoundaryProps {
  children: ReactNode;
}

interface MapErrorBoundaryState {
  hasError: boolean;
}

class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  constructor(props: MapErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted/20 p-6 text-center">
          <AlertTriangle className="size-8 text-amber-500" />
          <p className="text-sm font-semibold">Unable to load map component</p>
          <p className="text-muted-foreground text-xs">
            Please check your network connection or try refreshing the page.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

const FarmerMap = dynamic(() => import("@/components/map/FarmerMap"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export default function MapPage() {
  const [radiusKm, setRadiusKm] = useState(50);
  const { address } = useWallet();
  const geo = useGeolocation({ walletAddress: address });

  const { farmers, isLoading, error } = useFarmerLocations({
    latitude: geo.latitude,
    longitude: geo.longitude,
    radiusKm: radiusKm > 0 ? radiusKm : undefined,
  });

  return (
    // Header is fixed at h-16 (64px mobile) / h-28 (112px desktop). Reserve that space.
    <div className="relative h-[calc(100vh-64px)] w-full md:h-[calc(100vh-112px)]">
      {/* Filter pill — floats at top, centred. */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
        <div className="pointer-events-auto">
          <DistanceFilter selected={radiusKm} onChange={setRadiusKm} />
        </div>
      </div>

      {/* Status pills — stack below the filter on the right. */}
      <div className="pointer-events-none absolute right-4 top-20 z-10 flex flex-col items-end gap-2">
        {!geo.isLoading && geo.error && (
          <Pill tone="warning">
            <span>{geo.error}</span>
            <button
              type="button"
              onClick={geo.requestLocation}
              disabled={geo.isRequesting}
              className="pointer-events-auto font-semibold underline underline-offset-2 disabled:opacity-60"
            >
              {geo.isRequesting ? "Retrying..." : "Retry"}
            </button>
          </Pill>
        )}
        {error && <Pill tone="destructive">{error}</Pill>}
      </div>

      {/* Explicit opt-in: never prompt for precise location automatically. */}
      {!geo.isLoading && !geo.permissionGranted && !geo.isRequesting && (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-10 flex justify-center">
          <button
            type="button"
            onClick={geo.requestLocation}
            className="bg-primary text-primary-foreground pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-lg"
          >
            <MapPin className="size-3.5" />
            Use my location
          </button>
        </div>
      )}

      {/* Farmer count */}
      {!isLoading && !geo.isLoading && (
        <div className="bg-card/95 absolute bottom-4 left-4 z-10 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-sm">
          <Users className="text-muted-foreground size-3.5" />
          {farmers.length === 0
            ? "No farmers in this area"
            : `${farmers.length} farmer${farmers.length === 1 ? "" : "s"} nearby`}
        </div>
      )}

      {/* The map */}
      <div className="h-full w-full">
        {geo.isLoading ? (
          <MapSkeleton />
        ) : (
          <MapErrorBoundary>
            <FarmerMap
              farmers={farmers}
              userLat={geo.latitude!}
              userLng={geo.longitude!}
              radiusKm={radiusKm}
            />
          </MapErrorBoundary>
        )}
      </div>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "warning" | "destructive";
  children: React.ReactNode;
}) {
  const colour =
    tone === "warning"
      ? "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800"
      : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-sm ${colour}`}
    >
      {children}
    </div>
  );
}
