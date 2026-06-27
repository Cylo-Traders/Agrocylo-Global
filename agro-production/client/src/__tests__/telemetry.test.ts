import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

describe("Telemetry opt-in behavior", () => {
  let originalEnv: Record<string, string | undefined>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let sendBeaconSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();

    // Mock fetch and sendBeacon
    fetchSpy = vi.spyOn(global, "fetch" as any).mockResolvedValue(new Response());
    sendBeaconSpy = vi.spyOn(Navigator.prototype, "sendBeacon").mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchSpy.mockRestore();
    sendBeaconSpy.mockRestore();
  });

  it("does not send analytics when NEXT_PUBLIC_TELEMETRY_ENABLED is unset", async () => {
    delete process.env.NEXT_PUBLIC_TELEMETRY_ENABLED;
    vi.resetModules();

    const { trackPageView } = await import("@/lib/analytics");
    trackPageView("/home");

    // No fetch should have been made
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it("does not send analytics when NEXT_PUBLIC_TELEMETRY_ENABLED is false", async () => {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = "false";
    vi.resetModules();

    const { trackPageView } = await import("@/lib/analytics");
    trackPageView("/home");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it("sends analytics when NEXT_PUBLIC_TELEMETRY_ENABLED is true and URL is set", async () => {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = "true";
    process.env.NEXT_PUBLIC_TELEMETRY_URL = "https://telemetry.example.com/events";
    vi.resetModules();

    const { trackPageView, initAnalytics } = await import("@/lib/analytics");

    // Mock window for test
    if (typeof window !== "undefined") {
      vi.spyOn(window, "location", "get").mockReturnValue({
        href: "http://localhost:3000/home",
        pathname: "/home",
        protocol: "http:",
      } as any);
    }

    trackPageView("/home");
    initAnalytics();

    // Wait for the flush timeout
    await new Promise((resolve) => setTimeout(resolve, 2100));

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://telemetry.example.com/events",
      expect.any(Object)
    );
  });

  it("logs warning when telemetry is enabled but URL is not set", async () => {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = "true";
    delete process.env.NEXT_PUBLIC_TELEMETRY_URL;
    vi.resetModules();

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { trackPageView } = await import("@/lib/analytics");

    trackPageView("/home");

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 2100));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Telemetry enabled but NEXT_PUBLIC_TELEMETRY_URL is not set")
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("does not send errors when NEXT_PUBLIC_TELEMETRY_ENABLED is unset", async () => {
    delete process.env.NEXT_PUBLIC_TELEMETRY_ENABLED;
    vi.resetModules();

    const { captureError } = await import("@/lib/errorTracking");
    captureError(new Error("Test error"));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it("redacts sensitive data in error tracking", async () => {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = "true";
    process.env.NEXT_PUBLIC_TELEMETRY_URL = "https://telemetry.example.com/errors";
    vi.resetModules();

    const { captureError } = await import("@/lib/errorTracking");

    const sensitiveContext = {
      apiKey: "sk_live_very_secret_key_123",
      password: "super_secret_password",
      walletAddress: "GAJST4HTMQ5IFDKDQ6UZKDWLSEJQHQ2F33JQZBBQ2RQBVLX2C4XMZY4",
      xdr: "AAAAAgAAASD...",
    };

    captureError(new Error("Test error"), sensitiveContext);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://telemetry.example.com/errors",
      expect.objectContaining({
        body: expect.stringContaining('"context":') &&
          !expect.stringContaining("sk_live_very_secret_key_123") &&
          expect.stringContaining("[redacted]"),
      })
    );
  });
});
