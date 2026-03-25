"use client";

import type { FarmerLocation } from "@/hooks/useFarmerLocations";

interface FarmerPopupProps {
  farmer: FarmerLocation;
  userLat?: number | null;
  userLng?: number | null;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function FarmerPopup({
  farmer,
  userLat,
  userLng,
}: FarmerPopupProps) {
  const distance =
    userLat != null && userLng != null
      ? haversineKm(userLat, userLng, farmer.latitude, farmer.longitude)
      : null;

  const location = [farmer.city, farmer.country].filter(Boolean).join(", ");

  return (
    <div className="min-w-[220px] font-sans">
      <div className="flex items-center gap-3 mb-2">
        {farmer.avatar_url ? (
          <img
            src={farmer.avatar_url}
            alt={farmer.display_name}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-lg">
            {farmer.display_name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="font-semibold text-neutral-900 text-sm">
            {farmer.display_name}
          </p>
          <p className="text-xs text-neutral-500">
            {distance != null && (
              <span>
                📍 {distance < 1 ? "<1" : Math.round(distance)}km away
              </span>
            )}
            {distance != null && location && " · "}
            {location}
          </p>
        </div>
      </div>

      {farmer.bio && (
        <p className="text-xs text-neutral-600 mb-3 line-clamp-2">
          &ldquo;{farmer.bio}&rdquo;
        </p>
      )}

      <div className="flex gap-2">
        <a
          href={`/profile/${farmer.wallet_address}`}
          className="flex-1 rounded-md bg-neutral-100 px-3 py-1.5 text-center text-xs font-medium text-neutral-700 hover:bg-neutral-200 transition-colors"
        >
          View Profile
        </a>
        <a
          href={`/orders/new?farmer=${farmer.wallet_address}`}
          className="flex-1 rounded-md bg-primary-600 px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-primary-700 transition-colors"
        >
          Create Order
        </a>
      </div>
    </div>
  );
}
