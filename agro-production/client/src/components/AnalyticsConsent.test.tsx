import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/context/I18nContext";
import AnalyticsConsent from "./AnalyticsConsent";

describe("AnalyticsConsent", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("offers explicit accept and decline choices while consent is unknown", () => {
    render(<I18nProvider><AnalyticsConsent /></I18nProvider>);

    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("persists a decline and lets the visitor reopen preferences", () => {
    render(<I18nProvider><AnalyticsConsent /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(localStorage.getItem("ap_analytics_consent")).toBe("denied");
    fireEvent.click(screen.getByRole("button", { name: "Analytics preferences" }));
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });

  it("fails closed when consent storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    render(<I18nProvider><AnalyticsConsent /></I18nProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(localStorage.getItem("ap_analytics_consent")).toBeNull();
  });
});
