import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function flushMicrotasks() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("analytics consent gating", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults consentState to "unknown" rather than "granted"', async () => {
    const { getAnalyticsConsent } = await import("./analytics");
    expect(getAnalyticsConsent()).toBe("unknown");
  });

  it('falls back to "unknown" (not "granted") for an unrecognized stored value', async () => {
    window.localStorage.setItem("agrocylo.analytics.consent", "yes-please");
    const { getAnalyticsConsent } = await import("./analytics");
    expect(getAnalyticsConsent()).toBe("unknown");
  });

  it("is a no-op for trackEvent-style calls while consent is unknown", async () => {
    const { trackPageView, trackClick, getAnalyticsEvents } = await import(
      "./analytics"
    );
    trackPageView("/marketplace");
    trackClick({ element: "button", label: "Buy" });
    expect(getAnalyticsEvents()).toHaveLength(0);
  });

  it("is a no-op for trackEvent-style calls once consent is explicitly denied", async () => {
    const { setAnalyticsConsent, trackClick, getAnalyticsEvents } =
      await import("./analytics");
    setAnalyticsConsent("denied");
    trackClick({ element: "button", label: "Buy" });
    const clickEvents = getAnalyticsEvents().filter(
      (event) => event.name === "click",
    );
    expect(clickEvents).toHaveLength(0);
  });

  it("records events once consent is granted", async () => {
    const { setAnalyticsConsent, trackClick, getAnalyticsEvents } =
      await import("./analytics");
    setAnalyticsConsent("granted");
    trackClick({ element: "button", label: "Buy" });
    const clickEvents = getAnalyticsEvents().filter(
      (event) => event.name === "click",
    );
    expect(clickEvents).toHaveLength(1);
  });

  it("transitions consent states and mirrors them in the snapshot", async () => {
    const {
      setAnalyticsConsent,
      trackPageView,
      getAnalyticsSnapshot,
    } = await import("./analytics");

    trackPageView("/while-unknown");
    expect(
      getAnalyticsSnapshot().events.filter((e) => e.name === "page_view"),
    ).toHaveLength(0);

    setAnalyticsConsent("denied");
    trackPageView("/while-denied");
    const denied = getAnalyticsSnapshot();
    expect(denied.consent).toBe("denied");
    expect(
      denied.events.filter((e) => e.name === "page_view"),
    ).toHaveLength(0);

    setAnalyticsConsent("granted");
    trackPageView("/while-granted");
    const granted = getAnalyticsSnapshot();
    expect(granted.consent).toBe("granted");
    expect(
      granted.events.filter((e) => e.name === "page_view"),
    ).toHaveLength(1);
  });
});

describe("analytics store subscription", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies subscribers asynchronously, never on the synchronous call stack", async () => {
    const { setAnalyticsConsent, subscribeAnalytics, trackClick } =
      await import("./analytics");

    setAnalyticsConsent("granted");
    await flushMicrotasks();

    const listener = vi.fn();
    subscribeAnalytics(listener);

    trackClick({ element: "button", label: "Buy" });

    // A synchronous notification here is exactly what triggers
    // "useInsertionEffect must not schedule updates" in Next.js.
    expect(listener).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("coalesces bursts of events into a single subscriber notification", async () => {
    const { setAnalyticsConsent, subscribeAnalytics, trackClick } =
      await import("./analytics");

    setAnalyticsConsent("granted");
    await flushMicrotasks();

    const listener = vi.fn();
    subscribeAnalytics(listener);

    trackClick({ element: "button", label: "One" });
    trackClick({ element: "button", label: "Two" });
    trackClick({ element: "button", label: "Three" });

    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns a stable snapshot reference until the store actually changes", async () => {
    const { setAnalyticsConsent, trackClick, getAnalyticsSnapshot } =
      await import("./analytics");

    setAnalyticsConsent("granted");

    const first = getAnalyticsSnapshot();
    expect(getAnalyticsSnapshot()).toBe(first);

    trackClick({ element: "button", label: "Buy" });

    const next = getAnalyticsSnapshot();
    expect(next).not.toBe(first);
    expect(next.events).toHaveLength(first.events.length + 1);
  });

  it("does not record a page view when pushState runs, avoiding double-counting route changes", async () => {
    const mod = await import("./analytics");

    // Next.js App Router calls pushState inside an insertion effect. Analytics
    // must not hook it (route changes are tracked via usePathname instead),
    // otherwise a single navigation would be recorded twice and would schedule
    // an update from within the insertion effect.
    mod.initAnalytics();
    await flushMicrotasks();

    mod.setAnalyticsConsent("granted");
    await flushMicrotasks();

    const listener = vi.fn();
    mod.subscribeAnalytics(listener);

    window.history.pushState({}, "", "/marketplace");

    expect(
      mod.getAnalyticsEvents().filter((event) => event.name === "page_view"),
    ).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
