import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGeolocation } from "./useGeolocation";
import * as profileService from "@/services/profileService";

vi.mock("@/services/profileService", () => ({
  getSavedLocation: vi.fn(),
}));

const LAGOS_LAT = 6.5244;
const LAGOS_LNG = 3.3792;

type PositionCallback = (position: {
  coords: { latitude: number; longitude: number };
}) => void;
type ErrorCallback = (error: { code: number; message: string }) => void;

function installGeolocation(
  getCurrentPosition: (
    success: PositionCallback,
    error: ErrorCallback,
  ) => void,
) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
}

function removeGeolocation() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: undefined,
  });
}

describe("useGeolocation", () => {
  beforeEach(() => {
    vi.mocked(profileService.getSavedLocation).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    removeGeolocation();
  });

  it("does not prompt the browser for location on mount", async () => {
    const getCurrentPosition = vi.fn();
    installGeolocation(getCurrentPosition);

    const { result } = renderHook(() => useGeolocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(result.current.latitude).toBe(LAGOS_LAT);
    expect(result.current.longitude).toBe(LAGOS_LNG);
    expect(result.current.error).toBeNull();
    expect(result.current.permissionGranted).toBe(false);
    expect(result.current.source).toBe("fallback");
  });

  it("requests the browser position when requestLocation is called", async () => {
    installGeolocation((success) =>
      success({ coords: { latitude: 12.34, longitude: 56.78 } }),
    );

    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.isRequesting).toBe(false));

    expect(result.current.latitude).toBe(12.34);
    expect(result.current.longitude).toBe(56.78);
    expect(result.current.error).toBeNull();
    expect(result.current.permissionGranted).toBe(true);
    expect(result.current.source).toBe("browser");
  });

  it("falls back to Lagos when permission is denied via requestLocation", async () => {
    installGeolocation((_success, error) =>
      error({ code: 1, message: "User denied Geolocation" }),
    );

    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.isRequesting).toBe(false));

    expect(result.current.latitude).toBe(LAGOS_LAT);
    expect(result.current.longitude).toBe(LAGOS_LNG);
    expect(result.current.error).toBe(
      "Location permission denied — showing Lagos, Nigeria",
    );
    expect(result.current.permissionGranted).toBe(false);
  });

  it("falls back to Lagos when the request times out", async () => {
    installGeolocation((_success, error) =>
      error({ code: 3, message: "Timeout expired" }),
    );

    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.isRequesting).toBe(false));

    expect(result.current.latitude).toBe(LAGOS_LAT);
    expect(result.current.longitude).toBe(LAGOS_LNG);
    expect(result.current.error).toBe(
      "Location request timed out — showing Lagos, Nigeria",
    );
    expect(result.current.permissionGranted).toBe(false);
  });

  it("falls back to Lagos when geolocation is unsupported", async () => {
    removeGeolocation();

    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.requestLocation());

    await waitFor(() =>
      expect(result.current.error).toBe("Geolocation not supported"),
    );

    expect(result.current.latitude).toBe(LAGOS_LAT);
    expect(result.current.longitude).toBe(LAGOS_LNG);
    expect(result.current.permissionGranted).toBe(false);
  });

  it("prefers a saved location when a wallet address is provided", async () => {
    vi.mocked(profileService.getSavedLocation).mockResolvedValue({
      lat: 9.1,
      lng: 7.2,
    });
    const getCurrentPosition = vi.fn();
    installGeolocation(getCurrentPosition);

    const { result } = renderHook(() =>
      useGeolocation({ walletAddress: "GADDRESS" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.latitude).toBe(9.1);
    expect(result.current.longitude).toBe(7.2);
    expect(result.current.permissionGranted).toBe(true);
    expect(result.current.source).toBe("saved");
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("does not prompt the browser when the saved location cannot be loaded", async () => {
    vi.mocked(profileService.getSavedLocation).mockRejectedValue(
      new Error("network"),
    );
    const getCurrentPosition = vi.fn();
    installGeolocation(getCurrentPosition);

    const { result } = renderHook(() =>
      useGeolocation({ walletAddress: "GADDRESS" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(result.current.latitude).toBe(LAGOS_LAT);
    expect(result.current.longitude).toBe(LAGOS_LNG);
    expect(result.current.source).toBe("fallback");
  });

  it("does not update state after unmount", async () => {
    let capturedSuccess: PositionCallback | undefined;
    installGeolocation((success) => {
      capturedSuccess = success;
    });

    const { result, unmount } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.requestLocation());
    unmount();

    expect(() =>
      capturedSuccess?.({ coords: { latitude: 1, longitude: 2 } }),
    ).not.toThrow();
    expect(result.current.latitude).toBe(LAGOS_LAT);
  });
});
