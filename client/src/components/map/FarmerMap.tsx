"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  Circle,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FarmerLocation } from "@/hooks/useFarmerLocations";
import FarmerPopup from "./FarmerPopup";

// Configurable tile provider via environment variables (Issue #1118)
const TILE_LAYER_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ||
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_LAYER_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Local SVG marker icons (Issue #1117 - avoid external unpkg CDN dependency)
const defaultMarkerSvg =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 36' width='25' height='41'><path fill='%233b82f6' d='M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12zm0 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z'/></svg>";

const farmerMarkerSvg =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 36' width='25' height='41'><path fill='%2322c55e' d='M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12zm0 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z'/></svg>";

const defaultIcon = L.icon({
  iconUrl: defaultMarkerSvg,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const farmerIcon = L.icon({
  iconUrl: farmerMarkerSvg,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  className: "farmer-marker",
});

const userIcon = L.divIcon({
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid white;box-shadow:0 0 6px rgba(59,130,246,0.5);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  className: "",
});

function RecenterMap({
  lat,
  lng,
}: {
  lat: number;
  lng: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

interface FarmerMapProps {
  farmers: FarmerLocation[];
  userLat: number;
  userLng: number;
  radiusKm: number;
}

export default function FarmerMap({
  farmers,
  userLat,
  userLng,
  radiusKm,
}: FarmerMapProps) {
  return (
    <MapContainer
      center={[userLat, userLng]}
      zoom={11}
      className="h-full w-full z-0"
      scrollWheelZoom
      aria-label="Farmer locations map"
    >
      <TileLayer
        attribution={TILE_LAYER_ATTRIBUTION}
        url={TILE_LAYER_URL}
      />

      <RecenterMap lat={userLat} lng={userLng} />

      {/* User location marker */}
      <Marker position={[userLat, userLng]} icon={userIcon}>
        <Popup>
          <p className="text-sm font-medium">You are here</p>
        </Popup>
      </Marker>

      {/* Radius circle */}
      {radiusKm > 0 && (
        <Circle
          center={[userLat, userLng]}
          radius={radiusKm * 1000}
          pathOptions={{
            color: "#22c55e",
            fillColor: "#22c55e",
            fillOpacity: 0.05,
            weight: 1,
          }}
        />
      )}

      {/* Farmer markers */}
      {farmers.map((farmer) => (
        <Marker
          key={farmer.wallet_address}
          position={[farmer.latitude, farmer.longitude]}
          icon={farmerIcon}
        >
          <Popup maxWidth={280} minWidth={220}>
            <FarmerPopup
              farmer={farmer}
              userLat={userLat}
              userLng={userLng}
            />
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
