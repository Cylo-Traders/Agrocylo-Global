"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import enMessages from "../locales/en/common.json";
import esMessages from "../locales/es/common.json";
import frMessages from "../locales/fr/common.json";

export type Locale = "en" | "es" | "fr";

export const SUPPORTED_LOCALES: Locale[] = ["en", "es", "fr"];
const LOCALE_STORAGE_KEY = "ap_locale";
/**
 * `storage` events only fire in *other* windows, so a same-tab locale change
 * must notify subscribers explicitly. This is the event `setLocale` dispatches
 * after writing the preference.
 */
const LOCALE_CHANGE_EVENT = "agrocylo:locale-change";

/** Nested translation tree, as loaded from the locale JSON bundles. */
type MessageTree = { [key: string]: string | MessageTree };

const messagesMap: Record<Locale, MessageTree> = {
  en: enMessages,
  es: esMessages,
  fr: frMessages,
};

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as string[]).includes(value);
}

/**
 * Reading persisted locale through `useSyncExternalStore` (#1084) rather than
 * a state mirror in an effect: the server and the hydration render both use
 * `getServerSnapshot` ("en"), so markup always matches, and React applies the
 * persisted preference immediately after hydration without a cascading
 * setState-in-effect — or a hydration mismatch for non-English readers.
 */
function subscribeToLocale(onChange: () => void): () => void {
  window.addEventListener(LOCALE_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(LOCALE_CHANGE_EVENT, onChange);
}

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : "en";
  } catch {
    /* storage unavailable (private mode, quota) — stay on the default */
    return "en";
  }
}

function getLocaleSnapshot(): Locale {
  return readStoredLocale();
}

function getServerLocaleSnapshot(): Locale {
  return "en";
}

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {},
  t: (key: string, fallback?: string) => fallback || key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(
    subscribeToLocale,
    getLocaleSnapshot,
    getServerLocaleSnapshot,
  );

  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the event below still applies it for this session */
    }
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
  }, []);

  const t = useCallback(
    (keyPath: string, fallback?: string): string => {
      const keys = keyPath.split(".");
      let current: string | MessageTree | undefined = messagesMap[locale] ?? enMessages;
      for (const k of keys) {
        if (current && typeof current === "object" && k in current) {
          current = current[k];
        } else {
          return fallback || keyPath;
        }
      }
      return typeof current === "string" ? current : fallback || keyPath;
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
