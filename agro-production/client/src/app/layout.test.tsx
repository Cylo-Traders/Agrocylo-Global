import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ resolveProductionGate: vi.fn() }));

vi.mock("@/lib/productionGate", () => gate);
vi.mock("@/theme/theme", () => ({ themeBootstrapScript: "" }));
vi.mock("@/context/I18nContext", () => ({ I18nProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/context/ThemeContext", () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/context/WalletContext", () => ({ WalletProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/NavBar", () => ({ default: () => null }));
vi.mock("@/components/AnalyticsInit", () => ({ default: () => null }));
vi.mock("@/components/AnalyticsConsent", () => ({ default: () => null }));
vi.mock("@/components/PwaSetup", () => ({ default: () => null }));
vi.mock("@/components/HandoffConsumer", () => ({ default: () => null }));
vi.mock("@/components/PendingTransactionsResolver", () => ({ default: () => null }));
vi.mock("@/components/ProductionUnavailable", () => ({
  default: ({ reason }: { reason: string }) => createElement("p", { "data-testid": "unavailable" }, reason),
}));

import RootLayout from "./layout";

describe("RootLayout production gate imports", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders route content when the gate is enabled", () => {
    gate.resolveProductionGate.mockReturnValue({ enabled: true, reason: "enabled" });

    const html = renderToStaticMarkup(createElement(RootLayout, null, createElement("p", null, "route content")));

    expect(gate.resolveProductionGate).toHaveBeenCalledOnce();
    expect(html).toContain("route content");
  });

  it("renders the unavailable state when the gate is disabled", () => {
    gate.resolveProductionGate.mockReturnValue({ enabled: false, reason: "flag is disabled" });

    const html = renderToStaticMarkup(createElement(RootLayout, null, createElement("p", null, "route content")));

    expect(html).toContain("flag is disabled");
    expect(html).not.toContain("route content");
  });
});
