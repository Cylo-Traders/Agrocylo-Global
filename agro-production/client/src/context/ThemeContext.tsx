"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { trackThemeToggled } from "@/lib/analytics";
import {
  type Theme,
  getMatchMedia,
  readStoredTheme,
  readSystemTheme,
  applyThemeClass,
  persistTheme,
  resolveInitialTheme,
} from "@/theme/theme";

export type { Theme };

interface ThemeContextType {
  /** The active choice, whether persisted or inherited from the OS. */
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  resolvedTheme: Theme;
}

const defaultCtx: ThemeContextType = {
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
  resolvedTheme: "light",
};

export const ThemeContext = createContext<ThemeContextType>(defaultCtx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Seeded synchronously instead of in an effect: the bootstrap script in
  // `layout.tsx` has already put the right class on `<html>`, so the very first
  // client render agrees with the DOM and there is no flash or hydration
  // mismatch. Falling back to storage/OS keeps the provider correct when it is
  // mounted without the script (tests, Storybook).
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return "light";
    const root = document.documentElement;
    if (root.classList.contains("dark")) return "dark";
    if (root.classList.contains("light")) return "light";
    return resolveInitialTheme();
  });

  // `<html>` is the external system here: keep its classes in step with state
  // on every change, including the first one, so the palette never lags behind
  // what the toggle says is active.
  useEffect(() => {
    applyThemeClass(document.documentElement, theme);
  }, [theme]);

  useEffect(() => {
    const mq = getMatchMedia();
    if (!mq) return;

    const handler = () => {
      // A persisted choice is a deliberate override, so the OS must not
      // overwrite it.
      if (readStoredTheme()) return;
      setThemeState(readSystemTheme(mq));
    };

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener?.("change", handler);
    }
    // Safari < 14 only has the deprecated listener API.
    mq.addListener?.(handler);
    return () => mq.removeListener?.(handler);
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    persistTheme(newTheme);
    trackThemeToggled(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, resolvedTheme: theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
