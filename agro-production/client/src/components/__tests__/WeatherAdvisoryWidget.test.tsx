import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WeatherAdvisoryWidget } from "../WeatherAdvisoryWidget";
import userEvent from "@testing-library/user-event";

vi.mock("next/dynamic", () => ({
  default: (fn: any) => {
    const Component = () => <div data-testid="farmer-map">Map</div>;
    Component.displayName = "DynamicFarmerMap";
    return Component;
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

global.fetch = vi.fn();

describe("WeatherAdvisoryWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

    afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state", () => {
    (global.fetch as any).mockImplementation(() => new Promise(() => {}));
    render(<WeatherAdvisoryWidget />);
    expect(screen.getByText(/weather advisories/i)).toBeInTheDocument();
  });

  it("renders error state", async () => {
    (global.fetch as any).mockRejectedValue(new Error("Failed to fetch"));

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument();
    });
  });

  it("renders no advisory state", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(screen.getByText(/no active weather advisories/i)).toBeInTheDocument();
      expect(screen.getByText(/conditions are favorable/i)).toBeInTheDocument();
    });
  });

  it("renders active advisories", async () => {
    const mockAdvisories = [
      {
        id: "1",
        severity: "high",
        type: "Heavy Rain Warning",
        description: "Expect heavy rainfall in the next 24 hours",
        location: { lat: 10, lng: 20, name: "Farm Area" },
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ];

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockAdvisories,
    });

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(screen.getByText("Heavy Rain Warning")).toBeInTheDocument();
      expect(screen.getByText(/expect heavy rainfall/i)).toBeInTheDocument();
    });
  });

  it("filters out expired advisories", async () => {
    const mockAdvisories = [
      {
        id: "1",
        severity: "low",
        type: "Expired Advisory",
        description: "This should not appear",
        location: { lat: 10, lng: 20, name: "Farm Area" },
        issuedAt: new Date(Date.now() - 172800000).toISOString(),
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ];

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockAdvisories,
    });

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(screen.queryByText("Expired Advisory")).not.toBeInTheDocument();
      expect(screen.getByText(/no active weather advisories/i)).toBeInTheDocument();
    });
  });

  it("retries on button click after failure", async () => {
    const user = userEvent.setup();

    (global.fetch as any).mockResolvedValueOnce({ ok: false });
    render(<WeatherAdvisoryWidget />);

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "1",
          severity: "moderate",
          type: "New Alert",
          description: "Test",
          location: { lat: 10, lng: 20, name: "Farm" },
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    });

    await user.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByText("New Alert")).toBeInTheDocument();
    });
  });

  it("calls the correct API endpoint", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(<WeatherAdvisoryWidget farmerId="farmer-1" location={{ lat: 6.5, lng: 3.4 }} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/v1/weather/advisories");
    expect(calledUrl).toContain("farmerId=farmer-1");
    expect(calledUrl).toContain("lat=6.5");
    expect(calledUrl).toContain("lng=3.4");
  });

  it("View All link points to /notifications", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(<WeatherAdvisoryWidget />);

    await waitFor(() => {
      expect(screen.getByText(/no active weather advisories/i)).toBeInTheDocument();
    });

    const link = screen.getByRole("link", { name: /view all notifications/i });
    expect(link).toHaveAttribute("href", "/notifications");
  });

  it("cancels the fetch on unmount", () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");

    (global.fetch as any).mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<WeatherAdvisoryWidget />);
    unmount();

    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });
});
