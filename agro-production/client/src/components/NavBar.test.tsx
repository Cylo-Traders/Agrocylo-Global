import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import NavBar from "@/components/NavBar";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/campaigns") }));

vi.mock("@/components/WalletConnect", () => ({
  default: () => <button type="button">Connect wallet</button>,
}));

vi.mock("@/components/LanguageSwitcher", () => ({
  default: () => <label>Language</label>,
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ resolvedTheme: "light", toggleTheme: vi.fn() }),
}));

vi.mock("@/context/I18nContext", () => ({
  useI18n: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const triggerLabel = "Open navigation menu";

describe("NavBar", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes a labelled toggle that reports its state", async () => {
    render(<NavBar />);
    const trigger = screen.getByRole("button", { name: triggerLabel });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).not.toBeVisible();

    await act(async () => {
      trigger.click();
    });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAccessibleName("Close navigation menu");
    expect(document.getElementById(panelId!)).toBeVisible();
  });

  it("marks the current page inside the mobile panel", async () => {
    render(<NavBar />);
    await act(async () => {
      screen.getByRole("button", { name: triggerLabel }).click();
    });

    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.length).toBeGreaterThan(0);
    for (const link of current) {
      expect(link).toHaveTextContent("Campaigns");
    }
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<NavBar />);
    const trigger = screen.getByRole("button", { name: triggerLabel });

    await act(async () => {
      trigger.click();
    });
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the wallet reachable without opening the menu", () => {
    render(<NavBar />);
    const nav = screen.getByRole("navigation");
    const trigger = within(nav).getByRole("button", { name: triggerLabel });
    const panel = document.getElementById(trigger.getAttribute("aria-controls")!)!;

    // The wallet is a sibling of the toggle, not a child of the collapsible
    // panel, so it stays operable on a 320px screen with the menu closed.
    const collapsedPanelWallets = within(panel).queryAllByRole("button", {
      name: /connect wallet/i,
    });
    expect(collapsedPanelWallets).toHaveLength(0);

    const outside = within(nav)
      .getAllByRole("button", { name: /connect wallet/i })
      .filter((button) => !panel.contains(button));
    expect(outside.length).toBeGreaterThan(0);
    for (const button of outside) {
      expect(button).toBeVisible();
      expect(button).not.toBeDisabled();
    }
  });

  it("offers every primary destination in the collapsed panel", async () => {
    render(<NavBar />);
    await act(async () => {
      screen.getByRole("button", { name: triggerLabel }).click();
    });

    const panel = document.getElementById(
      screen.getByRole("button", { name: /close/i }).getAttribute("aria-controls")!,
    )!;

    for (const label of ["Marketplace", "Campaigns", "Orders", "Farmer", "Dashboard"]) {
      expect(within(panel).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("closes when a destination inside the panel is activated", async () => {
    render(<NavBar />);
    const trigger = screen.getByRole("button", { name: triggerLabel });

    await act(async () => {
      trigger.click();
    });
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const panel = document.getElementById(
      trigger.getAttribute("aria-controls")!,
    )!;
    await act(async () => {
      within(panel).getByRole("link", { name: "Orders" }).click();
    });

    expect(screen.getByRole("button", { name: triggerLabel })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("NavBar theme integration", () => {
  it("labels the theme toggle from the resolved theme", async () => {
    vi.doMock("@/context/ThemeContext", () => ({
      useTheme: () => ({ resolvedTheme: "dark", toggleTheme: vi.fn() }),
    }));
    vi.resetModules();
    const { default: FreshNavBar } = await import("@/components/NavBar");
    render(<FreshNavBar />);
    expect(screen.getAllByRole("button", { name: "Switch to light mode" }).length).toBeGreaterThan(
      0,
    );
  });
});
