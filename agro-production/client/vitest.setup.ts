import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom does not implement `matchMedia`, so `ThemeContext` would throw on
 * mount. The stub is controllable per test via
 * `window.__setPrefersDark(true | false)` (issue #1055).
 */
type MediaListener = (event: MediaQueryListEvent) => void;

declare global {
  var __setPrefersDark: (matches: boolean) => void;
}

let prefersDark = false;
const listeners = new Set<MediaListener>();

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      media: query,
      get matches() {
        return query.includes("dark") ? prefersDark : false;
      },
      onchange: null,
      addEventListener: (_type: string, listener: MediaListener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: MediaListener) => {
        listeners.delete(listener);
      },
      addListener: (listener: MediaListener) => {
        listeners.add(listener);
      },
      removeListener: (listener: MediaListener) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    }),
  });
}

globalThis.__setPrefersDark = (matches: boolean) => {
  prefersDark = matches;
  for (const listener of listeners) {
    listener({ matches } as MediaQueryListEvent);
  }
};

installMatchMedia();

afterEach(() => {
  cleanup();
  listeners.clear();
  prefersDark = false;
  document.documentElement.classList.remove("light", "dark");
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
