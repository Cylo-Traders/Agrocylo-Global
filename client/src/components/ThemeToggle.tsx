"use client";

import { useEffect, useState } from "react";
import { getStoredTheme, setStoredTheme, getEffectiveTheme, type Theme } from "@/lib/theme";
import { trackEvent } from "@/lib/analytics";

function SunIcon() {
  return (
    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  function toggle() {
    const current = getEffectiveTheme();
    const next: Theme = current === "dark" ? "light" : "dark";
    setStoredTheme(next);
    setTheme(next);
    trackEvent("theme_toggled", { theme: next });
  }

  const isDark = getEffectiveTheme() === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center justify-center p-2 rounded-md hover:bg-white/10 transition-colors"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-live="polite"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
