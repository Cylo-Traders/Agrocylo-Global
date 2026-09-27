/**
 * Theme primitives shared by the React provider and the inline pre-paint script.
 *
 * The provider and the bootstrap script must agree on the class contract, so
 * every decision lives here and is re-implemented as a string only for the
 * synchronous `document.head` bootstrap that has to run before first paint
 * (issue #1055).
 */

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "ap_theme";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/**
 * Minimal `matchMedia` surface so jsdom and old Safari are both covered.
 *
 * The legacy `addListener` pair is kept because Safari < 14 only implements
 * those; `ThemeContext` falls back to them when `addEventListener` is absent.
 */
export type MatchMediaLike = Pick<MediaQueryList, "matches"> & {
  addEventListener?: MediaQueryList["addEventListener"];
  removeEventListener?: MediaQueryList["removeEventListener"];
  addListener?: MediaQueryList["addListener"];
  removeListener?: MediaQueryList["removeListener"];
};

/**
 * `localStorage` throws in Safari private mode and when storage is disabled by
 * policy, so every access is guarded and treated as "no stored preference".
 */
function safeStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    return storage;
  } catch {
    return null;
  }
}

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

/** Reads the persisted choice, ignoring anything that is not a valid theme. */
export function readStoredTheme(storage: StorageLike | null = safeStorage()): Theme | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Reads the OS preference, defaulting to light when `matchMedia` is absent. */
export function readSystemTheme(matchMedia: MatchMediaLike | null = getMatchMedia()): Theme {
  try {
    return matchMedia?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function getMatchMedia(): MatchMediaLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.matchMedia(DARK_MEDIA_QUERY) as MatchMediaLike;
  } catch {
    return null;
  }
}

/**
 * Writes both classes explicitly instead of only adding `dark`.
 *
 * The old implementation could only *add* `dark`, which left the
 * `prefers-color-scheme` media query in charge whenever the visitor picked
 * light on a dark-mode OS. Now `light` and `dark` are mutually exclusive and
 * the `:not(.light):not(.dark)` guard in `globals.css` only follows the OS
 * while neither class is present.
 */
export function applyThemeClass(root: { classList: DOMTokenList } | null, theme: Theme): void {
  if (!root?.classList) return;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

export function persistTheme(theme: Theme): void {
  try {
    safeStorage()?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Persistence is best-effort; the class is already applied. */
  }
}

/** Persisted choice wins, otherwise follow the OS. */
export function resolveInitialTheme(
  storage: StorageLike | null = safeStorage(),
  matchMedia: MatchMediaLike | null = getMatchMedia(),
): Theme {
  return readStoredTheme(storage) ?? readSystemTheme(matchMedia);
}

/**
 * Blocking script injected in `<head>`.
 *
 * Without it the document renders with the `:root` light palette, React
 * hydrates, and only then does the effect swap in the dark palette, which
 * flashes light-on-dark. Running this synchronously means the correct classes
 * are on `<html>` before the first paint.
 */
export const themeBootstrapScript = `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var t=(s==="dark"||s==="light")?s:(window.matchMedia&&window.matchMedia("${DARK_MEDIA_QUERY}").matches?"dark":"light");var c=document.documentElement.classList;c.toggle("dark",t==="dark");c.toggle("light",t==="light");}catch(e){}})();`;
