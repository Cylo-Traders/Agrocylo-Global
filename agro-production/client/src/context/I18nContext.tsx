"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
import enMessages from "../locales/en/common.json";
import esMessages from "../locales/es/common.json";
import frMessages from "../locales/fr/common.json";

export type Locale = "en" | "es" | "fr";

const messagesMap: Record<Locale, Record<string, any>> = {
  en: enMessages,
  es: esMessages,
  fr: frMessages,
};

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
  const [locale, setLocale] = useState<Locale>("en");

  const t = (keyPath: string, fallback?: string): string => {
    const keys = keyPath.split(".");
    let current: any = messagesMap[locale] || enMessages;
    for (const k of keys) {
      if (current && typeof current === "object" && k in current) {
        current = current[k];
      } else {
        return fallback || keyPath;
      }
    }
    return typeof current === "string" ? current : fallback || keyPath;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
