import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WeatherAdvisoryWidget } from "../WeatherAdvisoryWidget";
import userEvent from "@testing-library/user-event";

vi.mock("next/dynamic", () => ({
  default: () => {
    const Component = () => <div data-testid="farmer-map">Map</div>;
    Component.displayName = "DynamicFarmerMap";
    return Component;
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

global.fetch = vi.fn();
// Loosely typed: tests stub only the Response fields the widget reads.
const fetchMock = vi.mocked(global.fetch) as unknown as ReturnType<typeof vi.fn>;

/** Server envelope (Issue #1341). */
function envelope(advisories: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    advisories,
    fetchedAt: new Date().toISOString(),
    ageSeconds: 30,
    ...overrides,
  };
}

describe("WeatherAdvisoryWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

    afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<WeatherAdvisoryWidget />);
    expect(screen.getByText(/weather advisories/i)).toBeInTheDocument();
  });

  it("renders error state", async () => {
    fetchMock.mockRejectedValue(new Error("Failed to fetch"));

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument();
    });
  });

  it("renders no advisory state", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => envelope([]),
    });

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(screen.getByText(/no active weather advisories/i)).toBeInTheDocument();
    });
    // Issue #1341: an empty list must never be presented as favorable weather.
    expect(screen.queryByText(/favorable/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("advisory-freshness")).toHaveTextContent(/updated just now/i);
  });

  it("renders an explicit unavailable state (503) without implying favorable conditions", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () =>
        envelope([], {
          status: "unavailable",
          fetchedAt: null,
          ageSeconds: null,
          reason: "provider_not_configured",
        }),
    });

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(
        screen.getByText(/weather advisory data is currently unavailable/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/no active weather advisories/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/favorable/i)).not.toBeInTheDocument();
  });

  it("flags stale data and shows its age", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () =>
        envelope([], { status: "stale", ageSeconds: 1200, reason: "provider_error" }),
    });

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(screen.getByText(/may be out of date/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId("advisory-freshness")).toHaveTextContent("Updated 20 min ago");
    expect(screen.queryByText(/favorable/i)).not.toBeInTheDocument();
  });

  it("treats a malformed response as an error rather than 'no advisories'", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(screen.getByText(/unexpected weather advisory response/i)).toBeInTheDocument();
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

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => envelope(mockAdvisories),
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

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => envelope(mockAdvisories),
    });

    render(<WeatherAdvisoryWidget />);
    await waitFor(() => {
      expect(screen.queryByText("Expired Advisory")).not.toBeInTheDocument();
      expect(screen.getByText(/no active weather advisories/i)).toBeInTheDocument();
    });
  });

  it("retries on button click after failure", async () => {
    const user = userEvent.setup();

    fetchMock.mockResolvedValueOnce({ ok: false });
    render(<WeatherAdvisoryWidget />);

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        envelope([
          {
            id: "1",
            severity: "moderate",
            type: "New Alert",
            description: "Test",
            location: { lat: 10, lng: 20, name: "Farm" },
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
        ]),
    });

    await user.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByText("New Alert")).toBeInTheDocument();
    });
  });

  it("calls the correct API endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => envelope([]),
    });

    render(<WeatherAdvisoryWidget farmerId="farmer-1" location={{ lat: 6.5, lng: 3.4 }} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/v1/weather/advisories");
    expect(calledUrl).toContain("farmerId=farmer-1");
    expect(calledUrl).toContain("lat=6.5");
    expect(calledUrl).toContain("lng=3.4");
  });

  it("View All link points to /notifications", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => envelope([]),
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

    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<WeatherAdvisoryWidget />);
    unmount();

    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });
});
