import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/errorTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errorTracking")>();
  return { ...actual, reportBoundaryError: vi.fn() };
});

import ErrorBoundary from "../error";
import NotFound from "../not-found";
import { I18nProvider } from "@/context/I18nContext";
import { reportBoundaryError } from "@/lib/errorTracking";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("app/error.tsx (Issue #1090)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(reportBoundaryError).mockClear();
  });

  it("reports the error once and shows a safe message", () => {
    const error = Object.assign(new Error("db password=hunter2 leaked"), { digest: "abc123" });
    renderWithI18n(<ErrorBoundary error={error} reset={vi.fn()} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toHaveFocus();
    expect(screen.getByText("abc123")).toBeInTheDocument();
    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("route-error-details")).not.toBeInTheDocument();

    expect(reportBoundaryError).toHaveBeenCalledTimes(1);
    expect(reportBoundaryError).toHaveBeenCalledWith(error, "app");
  });

  it("calls reset on Retry and links Home", () => {
    const reset = vi.fn();
    renderWithI18n(<ErrorBoundary error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/home");
  });

  it("shows message and stack only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const error = new Error("dev-only detail");
    renderWithI18n(<ErrorBoundary error={error} reset={vi.fn()} />);

    expect(screen.getByTestId("route-error-details")).toHaveTextContent("dev-only detail");
  });

  it("uses the active locale", async () => {
    localStorage.setItem("ap_locale", "es");
    await act(async () => {
      renderWithI18n(<ErrorBoundary error={new Error("x")} reset={vi.fn()} />);
    });
    expect(screen.getByRole("heading", { name: "Algo salió mal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBeInTheDocument();
  });
});

describe("app/not-found.tsx (Issue #1090)", () => {
  it("renders a labelled 404 with useful links", () => {
    renderWithI18n(<NotFound />);

    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Helpful links" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("link", { name: "Browse the marketplace" })).toHaveAttribute(
      "href",
      "/marketplace"
    );
    expect(screen.getByRole("link", { name: "View campaigns" })).toHaveAttribute("href", "/campaigns");
  });

  it("uses the active locale", async () => {
    localStorage.setItem("ap_locale", "fr");
    await act(async () => {
      renderWithI18n(<NotFound />);
    });
    expect(screen.getByRole("heading", { name: "Page introuvable" })).toBeInTheDocument();
  });
});

describe("reportBoundaryError (Issue #1090)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_URL", "https://telemetry.example.com/errors");
    fetchSpy = vi.fn(() => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends each error to Sentry and telemetry once, even if also captured elsewhere", async () => {
    const actual = await vi.importActual<typeof import("@/lib/errorTracking")>(
      "@/lib/errorTracking"
    );
    const Sentry = await import("@sentry/nextjs");
    vi.mocked(Sentry.captureException).mockClear();

    const error = Object.assign(new Error("boom"), { digest: "d1" });
    actual.reportBoundaryError(error, "app");
    actual.reportBoundaryError(error, "app"); // StrictMode re-run
    actual.captureError(error); // console.error path

    await vi.waitFor(() => expect(Sentry.captureException).toHaveBeenCalled());
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.context).toEqual({ boundary: "app", digest: "d1" });
    expect(body).not.toHaveProperty("stack");

    actual.reportBoundaryError(new Error("boom"), "app");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
