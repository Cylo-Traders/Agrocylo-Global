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

// Fix Leaflet default icon paths (broken by webpack)
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const farmerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
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
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
