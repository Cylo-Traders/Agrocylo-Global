"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardHeader, CardTitle, CardContent, Text } from "@/components/ui";
import { HeatMapPoint } from "@/types/demand";

interface RegionalHeatMapProps {
  data: HeatMapPoint[];
}

function RecenterMap({ points }: { points: HeatMapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => p.coordinates));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [points, map]);
  return null;
}

export default function RegionalHeatMap({ data }: RegionalHeatMapProps) {
  return (
    <Card variant="elevated" className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle>Regional Demand Heat Map</CardTitle>
      </CardHeader>
      <CardContent className="p-0 h-[400px]">
        <MapContainer
          center={[9.082, 7.533]}
          zoom={6}
          className="h-full w-full z-0"
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <RecenterMap points={data} />

          {data.map((point, idx) => (
            <Circle
              key={idx}
              center={point.coordinates}
              radius={point.intensity * 100000} // radius in meters
              pathOptions={{
                color: "#22c55e",
                fillColor: "#22c55e",
                fillOpacity: point.intensity * 0.5,
                weight: 1,
              }}
            >
              <Popup>
                <div className="p-1">
                  <Text variant="label" className="block mb-1">
                    {point.label}
                  </Text>
                  <Text variant="bodySmall" muted>
                    Demand Intensity: {Math.round(point.intensity * 100)}%
                  </Text>
                </div>
              </Popup>
            </Circle>
          ))}
        </MapContainer>
      </CardContent>
    </Card>
  );
}
