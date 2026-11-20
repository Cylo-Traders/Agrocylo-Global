"use client";

import { useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { apiBaseUrl } from "@/lib/apiConfig";

const FarmerMap = dynamic(() => import("./FarmerMap").then((mod) => ({ default: mod.default })), {
  ssr: false,
});

export interface WeatherAdvisory {
  id: string;
  severity: "low" | "moderate" | "high" | "extreme";
  type: string;
  description: string;
  location: { lat: number; lng: number; name: string };
  issuedAt: string;
  expiresAt?: string;
  farmerId?: string;
}

export type WeatherAdvisoryStatus = "ok" | "stale" | "unavailable";

export interface WeatherAdvisoriesResponse {
  status: WeatherAdvisoryStatus;
  advisories: WeatherAdvisory[];
  fetchedAt: string | null;
  source: string | null;
  stale?: boolean;
  message?: string;
}

interface WeatherAdvisoryWidgetProps {
  farmerId?: string;
  location?: { lat: number; lng: number };
}

const CLIENT_FRESH_TTL_MS = 15 * 60 * 1000;
const LOCATION_FILTER_RADIUS_KM = 100;

function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function normalizeAdvisoryPayload(
  raw: unknown,
): WeatherAdvisoriesResponse {
  // Never imply favorable conditions solely because an endpoint returned an
  // unverified bare empty array `[]` without freshness/status metadata (#1341).
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return {
        status: "unavailable",
        advisories: [],
        fetchedAt: null,
        source: null,
        stale: false,
        message:
          "Weather advisory source did not confirm data freshness; current conditions cannot be verified.",
      };
    }
    return {
      status: "ok",
      advisories: raw as WeatherAdvisory[],
      fetchedAt: null,
      source: null,
      stale: false,
    };
  }

  if (raw && typeof raw === "object") {
    const obj = raw as Partial<WeatherAdvisoriesResponse>;
    const advisories = Array.isArray(obj.advisories) ? obj.advisories : [];
    const fetchedAt = typeof obj.fetchedAt === "string" ? obj.fetchedAt : null;
    const source = typeof obj.source === "string" ? obj.source : null;
    let status: WeatherAdvisoryStatus =
      obj.status === "ok" || obj.status === "stale" || obj.status === "unavailable"
        ? obj.status
        : "unavailable";

    let stale = Boolean(obj.stale) || status === "stale";
    if (status === "ok") {
      if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) {
        if (advisories.length === 0) {
          status = "unavailable";
        }
      } else if (Date.now() - Date.parse(fetchedAt) > CLIENT_FRESH_TTL_MS) {
        status = "stale";
        stale = true;
      }
    }

    return {
      status,
      advisories,
      fetchedAt,
      source,
      stale,
      message: typeof obj.message === "string" ? obj.message : undefined,
    };
  }

  return {
    status: "unavailable",
    advisories: [],
    fetchedAt: null,
    source: null,
    stale: false,
    message: "Weather data unavailable",
  };
}

export function WeatherAdvisoryWidget({ farmerId, location }: WeatherAdvisoryWidgetProps) {
  // Callback before the resource that runs it (#1084): the fetch is keyed by
  // its inputs and aborted when they change or the owner unmounts, so a slow
  // response can never be rendered for the wrong location.
  const fetchAdvisories = useCallback(
    async (signal: AbortSignal): Promise<WeatherAdvisoriesResponse> => {
      const params = new URLSearchParams();
      if (farmerId) params.append("farmerId", farmerId);
      if (location) {
        params.append("lat", location.lat.toString());
        params.append("lng", location.lng.toString());
      }

      const url =
        apiBaseUrl(process.env.NEXT_PUBLIC_API_URL) +
        `/weather/advisories?${params}`;

      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error("Failed to fetch weather data");

      const raw = (await response.json()) as unknown;
      return normalizeAdvisoryPayload(raw);
    },
    [farmerId, location],
  );

  const requestKey = `${farmerId ?? ""}|${location?.lat ?? ""}|${location?.lng ?? ""}`;
  const { data, error, loading, reload } = useAsyncResource(
    requestKey,
    fetchAdvisories,
  );

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

  const envelope: WeatherAdvisoriesResponse = data ?? {
    status: "unavailable",
    advisories: [],
    fetchedAt: null,
    source: null,
    stale: false,
  };

  const now = new Date();
  const activeAdvisories = envelope.advisories.filter((adv) => {
    if (adv.expiresAt && new Date(adv.expiresAt) <= now) {
      return false;
    }
    if (farmerId && adv.farmerId && adv.farmerId !== farmerId) {
      return false;
    }
    if (
      location &&
      adv.location &&
      typeof adv.location.lat === "number" &&
      typeof adv.location.lng === "number"
    ) {
      const distKm = haversineDistanceKm(
        location.lat,
        location.lng,
        adv.location.lat,
        adv.location.lng,
      );
      if (distKm > LOCATION_FILTER_RADIUS_KM) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="bg-white border rounded-lg p-6 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold">Weather Advisories</h3>
          {envelope.fetchedAt && (
            <p className="text-xs text-gray-500 mt-0.5" data-testid="weather-freshness">
              Updated: {new Date(envelope.fetchedAt).toLocaleTimeString()}
              {envelope.source ? ` · Source: ${envelope.source}` : ""}
            </p>
          )}
        </div>
        <Link
          href="/notifications"
          className="text-sm text-blue-600 hover:underline"
          aria-label="View all notifications"
        >
          View All
        </Link>
      </div>

      {envelope.status === "unavailable" ? (
        <div
          className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center"
          role="status"
          data-testid="weather-unavailable"
        >
          <p className="font-medium text-amber-900">Weather data unavailable</p>
          <p className="text-sm text-amber-800 mt-1">
            {envelope.message ||
              "Unable to verify current weather conditions for this location."}
          </p>
          <button
            onClick={reload}
            className="mt-3 text-amber-900 text-sm font-medium underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {envelope.status === "stale" && (
            <div
              className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 flex justify-between items-center"
              role="status"
              data-testid="weather-stale-notice"
            >
              <div className="text-xs text-yellow-800">
                <p className="font-semibold">Weather data may be outdated</p>
                <p>
                  {envelope.message ||
                    "Showing last known advisory snapshot while live updates are unavailable."}
                </p>
              </div>
              <button
                onClick={reload}
                className="text-xs font-medium text-yellow-900 underline ml-3"
              >
                Retry
              </button>
            </div>
          )}

          {activeAdvisories.length === 0 ? (
            <div className="text-center py-8">
              <span className="text-4xl mb-2 block" aria-hidden="true">
                {envelope.status === "stale" ? "🌥️" : "☀️"}
              </span>
              <p className="text-gray-600">No active weather advisories</p>
              {envelope.status === "ok" ? (
                <p className="text-sm text-gray-500 mt-1">
                  Conditions are favorable
                </p>
              ) : (
                <p className="text-sm text-yellow-700 mt-1">
                  Current conditions cannot be confirmed while data is stale
                </p>
              )}
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
        </>
      )}
    </div>
  );
}
