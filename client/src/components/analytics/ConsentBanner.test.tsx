import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsentBanner from "./ConsentBanner";
import { AnalyticsProvider } from "@/context/AnalyticsContext";
import {
  getAnalyticsEvents,
  getAnalyticsSnapshot,
  resetAnalyticsForTests,
} from "@/lib/analytics";

describe("ConsentBanner (Issue #1415)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetAnalyticsForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetAnalyticsForTests();
  });

  it("dismisses the banner and records a consent_changed event when Accept is clicked", async () => {
    render(
      <AnalyticsProvider>
        <ConsentBanner />
      </AnalyticsProvider>,
    );

    expect(screen.getByTestId("analytics-consent-banner")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });

    expect(
      screen.queryByTestId("analytics-consent-banner"),
    ).not.toBeInTheDocument();
    expect(getAnalyticsSnapshot().consent).toBe("granted");
    expect(
      getAnalyticsEvents().some(
        (e) => e.name === "consent_changed" && e.properties.consent === "granted",
      ),
    ).toBe(true);
  });

  it("dismisses the banner and records a consent_changed event when Decline is clicked", async () => {
    render(
      <AnalyticsProvider>
        <ConsentBanner />
      </AnalyticsProvider>,
    );

    expect(screen.getByTestId("analytics-consent-banner")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    });

    expect(
      screen.queryByTestId("analytics-consent-banner"),
    ).not.toBeInTheDocument();
    expect(getAnalyticsSnapshot().consent).toBe("denied");
    expect(
      getAnalyticsEvents().some(
        (e) => e.name === "consent_changed" && e.properties.consent === "denied",
      ),
    ).toBe(true);
  });

  it("still dismisses the banner in memory when localStorage.setItem throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    render(
      <AnalyticsProvider>
        <ConsentBanner />
      </AnalyticsProvider>,
    );

    expect(screen.getByTestId("analytics-consent-banner")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });

    expect(
      screen.queryByTestId("analytics-consent-banner"),
    ).not.toBeInTheDocument();
    expect(getAnalyticsSnapshot().consent).toBe("granted");
  });
});
