import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFarmerLocations, type FarmerLocation } from "./useFarmerLocations";

const farmer: FarmerLocation = {
  wallet_address: "GFARMER",
  display_name: "Green Valley",
  bio: null,
  avatar_url: null,
  latitude: 6.5,
  longitude: 3.3,
  city: "Lagos",
  country: "Nigeria",
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("useFarmerLocations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches farmers and stops loading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ farmers: [farmer] })),
    );

    const { result } = renderHook(() => useFarmerLocations());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.farmers).toEqual([farmer]);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/locations/farmers"),
    );
  });

  it("accepts a `data` payload as a fallback shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: [farmer] })),
    );

    const { result } = renderHook(() => useFarmerLocations());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.farmers).toEqual([farmer]);
  });

  it("only sends coordinates and radius when they are provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ farmers: [] })),
    );

    const { result } = renderHook(() =>
      useFarmerLocations({ latitude: 6.5, longitude: 3.3, radiusKm: 25 }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("lat=6.5");
    expect(url).toContain("lng=3.3");
    expect(url).toContain("radius=25");
  });

  it("omits the query string when no filters are supplied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ farmers: [] })),
    );

    const { result } = renderHook(() => useFarmerLocations());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).not.toContain("?");
    expect(url).not.toContain("radius=");
  });

  it("surfaces an error and clears farmers when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, false, 500)),
    );

    const { result } = renderHook(() => useFarmerLocations());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch farmers: 500");
    expect(result.current.farmers).toEqual([]);
  });

  it("surfaces network failures as errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    const { result } = renderHook(() => useFarmerLocations());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("offline");
    expect(result.current.farmers).toEqual([]);
  });

  it("refetches on demand", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ farmers: [] }))
      .mockResolvedValueOnce(jsonResponse({ farmers: [farmer] }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFarmerLocations());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.farmers).toEqual([]);

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.farmers).toEqual([farmer]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
