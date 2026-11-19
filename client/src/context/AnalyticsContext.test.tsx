import React, { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnalyticsProvider,
  useAnalyticsContext,
  type AnalyticsContextValue,
} from "./AnalyticsContext";
import {
  initAnalytics,
  resetAnalyticsForTests,
  setAnalyticsConsent,
} from "@/lib/analytics";

let latest: AnalyticsContextValue | null = null;

// Called once per committed context value, so its call count is a precise
// measure of analytics-driven re-renders.
const onCommit = vi.fn((ctx: AnalyticsContextValue) => {
  latest = ctx;
});

function Consumer() {
  const ctx = useAnalyticsContext();

  useEffect(() => {
    onCommit(ctx);
  }, [ctx]);

  return (
    <div>
      <span data-testid="consent">{ctx.consent}</span>
      <span data-testid="event-count">{ctx.events.length}</span>
      <span data-testid="enabled">{String(ctx.enabled)}</span>
    </div>
  );
}

// Memoised so a test can distinguish re-renders driven by the context value
// from re-renders caused by a parent recreating the child element.
const MemoConsumer = React.memo(Consumer);

function renderProvider() {
  return render(
    <AnalyticsProvider>
      <MemoConsumer />
    </AnalyticsProvider>,
  );
}

function eventCount() {
  return Number(screen.getByTestId("event-count").textContent);
}

describe("AnalyticsProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setAnalyticsConsent("unknown");
    resetAnalyticsForTests();
    window.localStorage.clear();
    latest = null;
    onCommit.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("exposes the initial snapshot", () => {
    renderProvider();
    expect(screen.getByTestId("consent").textContent).toBe("unknown");
    expect(screen.getByTestId("enabled").textContent).toBe("true");
  });

  it("updates the snapshot when consent changes and events are tracked", async () => {
    renderProvider();

    await act(async () => {
      latest!.setConsent("granted");
    });

    expect(screen.getByTestId("consent").textContent).toBe("granted");
    // Granting consent records a single consent_changed event.
    expect(eventCount()).toBe(1);

    await act(async () => {
      latest!.trackPageView("/map");
    });

    expect(eventCount()).toBe(2);
  });

  it("re-renders consumers exactly once when consent is toggled", async () => {
    renderProvider();
    await act(async () => {});

    const before = onCommit.mock.calls.length;

    await act(async () => {
      latest!.setConsent("granted");
    });

    expect(onCommit.mock.calls.length - before).toBe(1);
  });

  it("does not re-render consumers when the snapshot is unchanged", () => {
    function Parent() {
      const [, setCount] = React.useState(0);
      return (
        <>
          <button onClick={() => setCount((value) => value + 1)}>bump</button>
          <AnalyticsProvider>
            <MemoConsumer />
          </AnalyticsProvider>
        </>
      );
    }

    render(<Parent />);
    const before = onCommit.mock.calls.length;

    fireEvent.click(screen.getByText("bump"));

    // The parent re-rendered, but the analytics snapshot reference is cached,
    // so the context value is stable and the consumer must not re-render.
    expect(onCommit.mock.calls.length).toBe(before);
  });

  it("updates the snapshot once per navigation via the pathname effect", async () => {
    renderProvider();

    await act(async () => {
      latest!.setConsent("granted");
    });

    const before = eventCount();

    await act(async () => {
      latest!.trackPageView("/map");
    });

    expect(eventCount()).toBe(before + 1);
  });

  it("does not schedule a synchronous update when pushState runs inside an insertion effect", async () => {
    // Mirrors how Next.js App Router updates history during an insertion
    // effect. Regression guard for
    // "useInsertionEffect must not schedule updates".
    function PushStateInInsertionEffect() {
      React.useInsertionEffect(() => {
        window.history.pushState({}, "", "/insertion-effect-route");
      }, []);
      return null;
    }

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      initAnalytics();

      await act(async () => {
        render(
          <AnalyticsProvider>
            <MemoConsumer />
            <PushStateInInsertionEffect />
          </AnalyticsProvider>,
        );
      });

      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
