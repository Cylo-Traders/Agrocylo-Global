import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  THEME_STORAGE_KEY,
  applyThemeClass,
  isTheme,
  persistTheme,
  readStoredTheme,
  readSystemTheme,
  resolveInitialTheme,
  themeBootstrapScript,
} from "@/theme/theme";

describe("theme primitives", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("light", "dark");
  });

  it("recognises only the two valid themes", () => {
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("solarized")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it("applies both classes so an explicit choice can outrank the OS", () => {
    const root = document.documentElement;

    applyThemeClass(root, "light");
    expect(root.classList.contains("light")).toBe(true);
    expect(root.classList.contains("dark")).toBe(false);

    // Regression guard for #1055: switching to light has to *remove* dark,
    // otherwise the prefers-color-scheme media query keeps winning.
    applyThemeClass(root, "dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("light")).toBe(false);

    applyThemeClass(root, "light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.classList.contains("light")).toBe(true);
  });

  it("tolerates a missing root", () => {
    expect(() => applyThemeClass(null, "dark")).not.toThrow();
  });

  it("ignores storage values that are not themes", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");
    expect(readStoredTheme()).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readStoredTheme(throwing)).toBeNull();
    expect(() => persistTheme("dark")).not.toThrow();
  });

  it("reads the system preference and falls back to light", () => {
    expect(readSystemTheme({ matches: true })).toBe("dark");
    expect(readSystemTheme({ matches: false })).toBe("light");
    expect(readSystemTheme(null)).toBe("light");
  });

  it("prefers the stored choice over the OS", () => {
    const storage = { getItem: () => "light", setItem: () => {} };
    expect(resolveInitialTheme(storage, { matches: true })).toBe("light");
    expect(resolveInitialTheme({ getItem: () => null, setItem: () => {} }, { matches: true })).toBe(
      "dark",
    );
  });

  it("persists the choice", () => {
    persistTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});

describe("theme bootstrap script", () => {
  const run = (source: string) => {
    new Function(source)();
  };

  beforeEach(() => {
    document.documentElement.classList.remove("light", "dark");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("picks light on a light OS with nothing stored", () => {
    globalThis.__setPrefersDark(false);
    run(themeBootstrapScript);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("picks dark on a dark OS before any React code runs", () => {
    globalThis.__setPrefersDark(true);
    run(themeBootstrapScript);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("lets a stored light choice beat a dark OS", () => {
    globalThis.__setPrefersDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    run(themeBootstrapScript);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("never throws when storage is unavailable", () => {
    globalThis.__setPrefersDark(false);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => run(themeBootstrapScript)).not.toThrow();
    spy.mockRestore();
  });
});

describe("ThemeProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.classList.remove("light", "dark");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies and persists an explicit choice", async () => {
    vi.doMock("@/lib/analytics", () => ({ trackThemeToggled: vi.fn() }));
    const { ThemeProvider, useTheme } = await import("@/context/ThemeContext");

    function Probe() {
      const { resolvedTheme, toggleTheme } = useTheme();
      return (
        <button type="button" onClick={toggleTheme}>
          {resolvedTheme}
        </button>
      );
    }

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    const button = await screen.findByRole("button", { name: /light|dark/ });
    expect(button).toHaveTextContent("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);

    await act(async () => {
      button.click();
    });

    expect(button).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("follows a live OS change only while nothing is stored", async () => {
    globalThis.__setPrefersDark(false);
    vi.doMock("@/lib/analytics", () => ({ trackThemeToggled: vi.fn() }));
    const { ThemeProvider, useTheme } = await import("@/context/ThemeContext");

    function Probe() {
      const { resolvedTheme } = useTheme();
      return <span data-testid="resolved">{resolvedTheme}</span>;
    }

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(await screen.findByTestId("resolved")).toHaveTextContent("light");

    await act(async () => {
      globalThis.__setPrefersDark(true);
    });
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");

    // Once the visitor chooses, the OS must stop overriding them.
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    await act(async () => {
      globalThis.__setPrefersDark(false);
      globalThis.__setPrefersDark(true);
    });
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });
});
