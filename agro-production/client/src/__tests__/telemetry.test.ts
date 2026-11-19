import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

describe("Telemetry opt-in behavior", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let sendBeaconSpy: ReturnType<typeof vi.fn>;
  let originalSendBeacon: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
    localStorage.removeItem("ap_analytics_consent");

    // Mock fetch and sendBeacon
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    originalSendBeacon = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
    sendBeaconSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeaconSpy });
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchSpy.mockRestore();
    sendBeaconSpy.mockRestore();
    if (originalSendBeacon) Object.defineProperty(navigator, "sendBeacon", originalSendBeacon);
    else Reflect.deleteProperty(navigator, "sendBeacon");
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

  it("does not queue events while consent is unknown", async () => {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = "true";
    process.env.NEXT_PUBLIC_TELEMETRY_URL = "https://telemetry.example.com/events";
    vi.resetModules();

    const { trackPageView } = await import("@/lib/analytics");
    trackPageView("/private");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it("does not send after a visitor declines analytics", async () => {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = "true";
    process.env.NEXT_PUBLIC_TELEMETRY_URL = "https://telemetry.example.com/events";
    vi.resetModules();

    const { setAnalyticsConsent, trackPageView } = await import("@/lib/analytics");
    setAnalyticsConsent("denied");
    trackPageView("/home");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it("clears queued events when consent is revoked", async () => {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = "true";
    process.env.NEXT_PUBLIC_TELEMETRY_URL = "https://telemetry.example.com/events";
    localStorage.setItem("ap_analytics_consent", "granted");
    vi.resetModules();

    const { setAnalyticsConsent, trackPageView } = await import("@/lib/analytics");
    trackPageView("/before-revocation");
    setAnalyticsConsent("denied");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it("sends analytics when NEXT_PUBLIC_TELEMETRY_ENABLED is true and URL is set", async () => {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = "true";
    process.env.NEXT_PUBLIC_TELEMETRY_URL = "https://telemetry.example.com/events";
    localStorage.setItem("ap_analytics_consent", "granted");
    vi.resetModules();

    const { trackPageView, initAnalytics } = await import("@/lib/analytics");

    // Mock window for test
    if (typeof window !== "undefined") {
      vi.spyOn(window, "location", "get").mockReturnValue({
        href: "http://localhost:3000/home",
        pathname: "/home",
        protocol: "http:",
      } as unknown as Location);
    }

    trackPageView("/home");
    initAnalytics();

    // Wait for the flush timeout
    await new Promise((resolve) => setTimeout(resolve, 2100));

    expect(sendBeaconSpy).toHaveBeenCalledWith(
      "https://telemetry.example.com/events",
      expect.any(String),
    );
  });

  it("logs warning when telemetry is enabled but URL is not set", async () => {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = "true";
    localStorage.setItem("ap_analytics_consent", "granted");
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
      expect.objectContaining({ body: expect.stringContaining('"context":') }),
    );
    const payload = String(fetchSpy.mock.calls[0][1]?.body);
    expect(payload).not.toContain("sk_live_very_secret_key_123");
    expect(payload).toContain('"walletAddress":"[redacted]"');
    expect(payload).toContain("[redacted]");
  });
});
