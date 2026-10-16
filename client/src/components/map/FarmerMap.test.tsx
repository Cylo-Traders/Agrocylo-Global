import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FarmerMap from "./FarmerMap";
import type { FarmerLocation } from "@/hooks/useFarmerLocations";

vi.mock("react-leaflet", async () => {
  const ReactModule = await import("react");
  return {
    MapContainer: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(
        "div",
        { "data-testid": "map-container" },
        children,
      ),
    TileLayer: () =>
      ReactModule.createElement("div", { "data-testid": "tile-layer" }),
    Marker: ({
      children,
      position,
    }: {
      children?: React.ReactNode;
      position: [number, number];
    }) =>
      ReactModule.createElement(
        "div",
        {
          "data-testid": "marker",
          "data-position": JSON.stringify(position),
        },
        children,
      ),
    Popup: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-testid": "popup" }, children),
    Circle: () =>
      ReactModule.createElement("div", { "data-testid": "circle" }),
    useMap: () => ({ setView: vi.fn(), getZoom: () => 11 }),
  };
});

vi.mock("leaflet", () => ({
  default: {
    icon: vi.fn(() => ({})),
    divIcon: vi.fn(() => ({})),
  },
}));

vi.mock("leaflet/dist/leaflet.css", () => ({}));

const farmers: FarmerLocation[] = [
  {
    wallet_address: "GFARMER1",
    display_name: "Green Valley",
    bio: "Fresh produce",
    avatar_url: null,
    latitude: 6.6,
    longitude: 3.4,
    city: "Lagos",
    country: "Nigeria",
  },
  {
    wallet_address: "GFARMER2",
    display_name: "Sunrise Produce",
    bio: null,
    avatar_url: null,
    latitude: 6.7,
    longitude: 3.5,
    city: "Abuja",
    country: "Nigeria",
  },
];

describe("FarmerMap", () => {
  it("renders the map, tile layer and a marker per farmer plus the user", () => {
    render(
      <FarmerMap
        farmers={farmers}
        userLat={6.5}
        userLng={3.3}
        radiusKm={50}
      />,
    );

    expect(screen.getByTestId("map-container")).toBeInTheDocument();
    expect(screen.getByTestId("tile-layer")).toBeInTheDocument();

    const markers = screen.getAllByTestId("marker");
    expect(markers).toHaveLength(farmers.length + 1);

    const userMarker = markers.find(
      (marker) => marker.getAttribute("data-position") === "[6.5,3.3]",
    );
    expect(userMarker).toBeTruthy();
  });

  it("renders popup content for each farmer", () => {
    render(
      <FarmerMap
        farmers={farmers}
        userLat={6.5}
        userLng={3.3}
        radiusKm={50}
      />,
    );

    expect(screen.getByText("Green Valley")).toBeInTheDocument();
    expect(screen.getByText("Sunrise Produce")).toBeInTheDocument();
  });

  it("draws the radius circle when a radius is selected", () => {
    render(
      <FarmerMap
        farmers={farmers}
        userLat={6.5}
        userLng={3.3}
        radiusKm={25}
      />,
    );

    expect(screen.getByTestId("circle")).toBeInTheDocument();
  });

  it("omits the radius circle when the radius is disabled", () => {
    render(
      <FarmerMap farmers={farmers} userLat={6.5} userLng={3.3} radiusKm={0} />,
    );

    expect(screen.queryByTestId("circle")).not.toBeInTheDocument();
  });
});
