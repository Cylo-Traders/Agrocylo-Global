"use client";

import { useState, useEffect, useCallback  } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

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
  const [advisories, setAdvisories] = useState<WeatherAdvisory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAdvisories = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoading(true);
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
        if (!response.ok) throw new Error("Failed to fetch advisories");

        const data = await response.json();
        setAdvisories(data);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load weather data");
      } finally {
        setLoading(false);
      }
    },
    [farmerId, location],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchAdvisories(controller.signal);
    return () => controller.abort();
  }, [fetchAdvisories]);


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
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
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
            onClick={() => fetchAdvisories()}
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
                    location,
                  },
                ]}
                center={location}
                zoom={10}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
