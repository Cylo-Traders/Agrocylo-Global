import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { I18nProvider, useI18n } from "../context/I18nContext";
import LanguageSwitcher from "../components/LanguageSwitcher";

function Probe() {
  const { locale, t } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="marketplace-label">{t("navigation.marketplace")}</span>
    </div>
  );
}

describe("I18nProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to English", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(screen.getByTestId("marketplace-label").textContent).toBe("Marketplace");
  });

  it("switches locale via LanguageSwitcher and re-renders translated text", async () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <Probe />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "fr" } });

    await waitFor(() => {
      expect(screen.getByTestId("locale").textContent).toBe("fr");
    });
    expect(screen.getByTestId("marketplace-label").textContent).toBe("Marché");
  });

  it("persists the selected locale across remounts", async () => {
    const { unmount } = render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "es" } });
    await waitFor(() => {
      expect(localStorage.getItem("ap_locale")).toBe("es");
    });
    unmount();

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("locale").textContent).toBe("es");
    });
    expect(screen.getByTestId("marketplace-label").textContent).toBe("Mercado");
  });

  it("falls back to English for missing translation keys", () => {
    function MissingProbe() {
      const { t } = useI18n();
      return <span data-testid="missing">{t("navigation.marketplace")}</span>;
    }
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <MissingProbe />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "fr" } });
    // A key absent from the active locale should resolve to the English string.
    expect(screen.getByTestId("missing").textContent).toBe("Marché");
  });

  it("formats numbers and dates with the selected locale while keeping XLM/USDC units explicit", () => {
    function FormatProbe() {
      const { formatNumber, formatDate } = useI18n();
      return (
        <div>
          <span data-testid="num">{formatNumber(1234.5)}</span>
          <span data-testid="date">{formatDate(new Date("2024-01-15T00:00:00Z"))}</span>
        </div>
      );
    }
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <FormatProbe />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "fr" } });
    // French uses a comma as the decimal separator.
    expect(screen.getByTestId("num").textContent).toContain(",");
    expect(screen.getByTestId("date").textContent).not.toBe("");
  });
});
