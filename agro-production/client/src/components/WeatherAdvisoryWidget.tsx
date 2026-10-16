"use client";

import { useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAsyncResource } from "@/hooks/useAsyncResource";

const FarmerMap = dynamic(() => import("./FarmerMap").then((mod) => ({ default: mod.default })), {
  ssr: false,
});

interface WeatherAdvisory {
  id: string;
  severity: "low" | "moderate" | "high" | "extreme";
  type: string;
  description: string;
  location: { lat: number; lng: number; name: string };
  issuedAt: string;
  expiresAt?: string;
}

interface WeatherAdvisoryWidgetProps {
  farmerId?: string;
  location?: { lat: number; lng: number };
}

export function WeatherAdvisoryWidget({ farmerId, location }: WeatherAdvisoryWidgetProps) {
  // Callback before the resource that runs it (#1084): the fetch is keyed by
  // its inputs and aborted when they change or the owner unmounts, so a slow
  // response can never be rendered for the wrong location.
  const fetchAdvisories = useCallback(
    async (signal: AbortSignal) => {
      const params = new URLSearchParams();
      if (farmerId) params.append("farmerId", farmerId);
      if (location) {
        params.append("lat", location.lat.toString());
        params.append("lng", location.lng.toString());
      }

      const url =
        (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1") +
        `/weather/advisories?${params}`;

      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error("Failed to fetch weather data");

      return (await response.json()) as WeatherAdvisory[];
    },
    [farmerId, location],
  );

  const requestKey = `${farmerId ?? ""}|${location?.lat ?? ""}|${location?.lng ?? ""}`;
  const { data, error, loading, reload } = useAsyncResource(
    requestKey,
    fetchAdvisories,
  );

  const advisories = data ?? [];

  const getSeverityColor = (severity: string) => {
    const colors = {
      low: "bg-blue-100 text-blue-800 border-blue-300",
      moderate: "bg-yellow-100 text-yellow-800 border-yellow-300",
      high: "bg-orange-100 text-orange-800 border-orange-300",
      extreme: "bg-red-100 text-red-800 border-red-300",
    };
    return colors[severity as keyof typeof colors] || colors.low;
  };

  const getSeverityIcon = (severity: string) => {
    const icons = {
      low: "ℹ️",
      moderate: "⚠️",
      high: "🔶",
      extreme: "🚨",
    };
    return icons[severity as keyof typeof icons] || icons.low;
  };

  if (loading) {
    return (
      <div className="bg-white border rounded-lg p-6 shadow-sm animate-pulse">
        {/* The heading stays visible while loading so assistive technology and
            screen readers keep the widget's name on screen. */}
        <h3 className="text-lg font-semibold mb-2">Weather Advisories</h3>
        <div className="h-32 bg-gray-200 rounded" aria-hidden="true"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-2">Weather Advisories</h3>
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={reload}
            className="mt-2 text-red-600 text-sm underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const activeAdvisories = advisories.filter((adv) => {
    if (!adv.expiresAt) return true;
    return new Date(adv.expiresAt) > new Date();
  });

  return (
    <div className="bg-white border rounded-lg p-6 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Weather Advisories</h3>
        <Link
          href="/notifications"
          className="text-sm text-blue-600 hover:underline"
          aria-label="View all notifications"
        >
          View All
        </Link>
      </div>

      {activeAdvisories.length === 0 ? (
        <div className="text-center py-8">
          <span className="text-4xl mb-2 block" aria-hidden="true">
            ☀️
          </span>
          <p className="text-gray-600">No active weather advisories</p>
          <p className="text-sm text-gray-500 mt-1">Conditions are favorable</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeAdvisories.map((advisory) => (
            <div
              key={advisory.id}
              className={`border rounded-lg p-4 ${getSeverityColor(advisory.severity)}`}
              role="alert"
              aria-live="polite"
            >
              <div className="flex items-start">
                <span
                  className="text-2xl mr-3"
                  aria-label={`${advisory.severity} severity`}
                >
                  {getSeverityIcon(advisory.severity)}
                </span>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-semibold">{advisory.type}</h4>
                    <span className="text-xs font-medium uppercase">
                      {advisory.severity}
                    </span>
                  </div>
                  <p className="text-sm mb-2">{advisory.description}</p>
                  <div className="flex justify-between items-center text-xs text-gray-600">
                    <span>{advisory.location.name}</span>
                    <span>
                      Issued: {new Date(advisory.issuedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {location && (
            <div className="mt-4 h-48 rounded-lg overflow-hidden">
              <FarmerMap
                farmers={[
                  {
                    id: farmerId || "current",
                    name: "Your Location",
                    latitude: location.lat,
                    longitude: location.lng,
                  },
                ]}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
