import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    trackFunnelStep: vi.fn(),
    trackFeatureAdoption: vi.fn(),
  }),
}));

import LocationConsent from "./LocationConsent";

function renderConsent() {
  const onComplete = vi.fn();
  render(
    <LocationConsent
      onComplete={onComplete}
      onBack={vi.fn()}
      isSubmitting={false}
    />,
  );
  return { onComplete };
}

async function openManualForm() {
  fireEvent.click(screen.getByText("Enter Manually Instead"));
  fireEvent.change(await screen.findByLabelText("City"), {
    target: { value: "Lagos" },
  });
  fireEvent.change(screen.getByLabelText("Country"), {
    target: { value: "Nigeria" },
  });
}

describe("LocationConsent manual entry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("geocodes the entered city and submits real coordinates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "6.4550575", lon: "3.3941795" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onComplete } = renderConsent();
    await openManualForm();

    fireEvent.click(screen.getByText("Save Location"));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        latitude: 6.4550575,
        longitude: 3.3941795,
        city: "Lagos",
        country: "Nigeria",
        isPublic: true,
      }),
    );

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("nominatim.openstreetmap.org/search");
    expect(url).toContain("city=Lagos");
    expect(url).toContain("country=Nigeria");
  });

  it("never submits a (0, 0) placeholder and surfaces an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );

    const { onComplete } = renderConsent();
    await openManualForm();

    fireEvent.click(screen.getByText("Save Location"));

    await screen.findByRole("alert");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows an error when the geocoding lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    const { onComplete } = renderConsent();
    await openManualForm();

    fireEvent.click(screen.getByText("Save Location"));

    await screen.findByRole("alert");
    expect(onComplete).not.toHaveBeenCalled();
  });
});
