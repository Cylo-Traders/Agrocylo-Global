"use client";

import { MapPin } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { getInitials } from "@/lib/utils";
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
  lon2: number,
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
    <div className="font-sans min-w-[240px] space-y-3">
      <div className="flex items-start gap-3">
        <Avatar className="size-10 shrink-0">
          {farmer.avatar_url ? (
            <AvatarImage
              src={farmer.avatar_url}
              alt={farmer.display_name}
            />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
            {getInitials(farmer.display_name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">
            {farmer.display_name}
          </p>
          <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
            <MapPin className="size-3" />
            {distance != null && (
              <span>
                {distance < 1 ? "<1" : Math.round(distance)}km
                {location ? " ·" : ""}
              </span>
            )}
            {location && <span>{location}</span>}
          </p>
        </div>
      </div>

      {farmer.bio && (
        <p className="text-foreground/80 line-clamp-2 text-xs italic">
          &ldquo;{farmer.bio}&rdquo;
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <a
          href={`/profile/${farmer.wallet_address}`}
          className={buttonVariants({
            variant: "outline",
            size: "sm",
            className: "flex-1",
          })}
        >
          View Profile
        </a>
        <a
          href={`/orders/new?farmer=${farmer.wallet_address}`}
          className={buttonVariants({
            size: "sm",
            className: "flex-1",
          })}
        >
          Create Order
        </a>
      </div>
    </div>
  );
}
