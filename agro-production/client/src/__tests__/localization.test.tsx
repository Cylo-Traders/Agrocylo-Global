import { describe, it, expect } from "vitest";
import enMessages from "../locales/en/common.json";
import esMessages from "../locales/es/common.json";
import frMessages from "../locales/fr/common.json";

const locales = { en: enMessages, es: esMessages, fr: frMessages } as const;

function collectKeyPaths(obj: Record<string, unknown>, path = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const currentPath = path ? `${path}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return collectKeyPaths(value as Record<string, unknown>, currentPath);
    }
    return [currentPath];
  });
}

function collectEmptyValues(obj: Record<string, unknown>, path = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const currentPath = path ? `${path}.${key}` : key;
    if (typeof value === "string") {
      return value.trim() === "" ? [currentPath] : [];
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return collectEmptyValues(value as Record<string, unknown>, currentPath);
    }
    return [];
  });
}

function getValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

describe("Localization", () => {
  it("has all required sections in every locale", () => {
    for (const messages of Object.values(locales)) {
      expect(messages.navigation).toBeDefined();
      expect(messages.campaigns).toBeDefined();
      expect(messages.sso).toBeDefined();
      expect(messages.welcome).toBeDefined();
    }
  });

  it("has identical key sets across en/es/fr (CI guard against locale drift)", () => {
    const [enPaths, esPaths, frPaths] = Object.values(locales).map((m) =>
      collectKeyPaths(m).sort(),
    );
    expect(esPaths).toEqual(enPaths);
    expect(frPaths).toEqual(enPaths);
  });

  it("has no empty translation values in any locale", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      expect(collectEmptyValues(messages), `empty values in ${locale}`).toEqual([]);
    }
  });

  it("falls back to English for any key missing in a non-English locale", () => {
    const enPaths = collectKeyPaths(enMessages);
    for (const [locale, messages] of Object.entries(locales)) {
      if (locale === "en") continue;
      for (const keyPath of enPaths) {
        const value = getValue(messages as Record<string, unknown>, keyPath);
        const fallback = getValue(enMessages as Record<string, unknown>, keyPath);
        // Every key must resolve to a non-empty string, either translated or via English fallback.
        const resolved = typeof value === "string" && value.trim() !== "" ? value : fallback;
        expect(typeof resolved, `${locale}:${keyPath} resolves`).toBe("string");
        expect((resolved as string).trim(), `${locale}:${keyPath} non-empty`).not.toBe("");
      }
    }
  });

  it("keeps XLM/USDC unit labels explicit and untranslated in price strings", () => {
    const unitPattern = /\b(XLM|USDC)\b/;
    for (const [locale, messages] of Object.entries(locales)) {
      const pricePaths = collectKeyPaths(messages).filter((p) => p.startsWith("prices."));
      for (const pricePath of pricePaths) {
        const value = getValue(messages as Record<string, unknown>, pricePath);
        if (typeof value !== "string") continue;
        // Price copy that references a settlement unit must keep the literal ticker.
        if (/\{\w+\}/.test(value) && /price|amount/i.test(pricePath)) {
          expect(value, `${locale}:${pricePath} keeps unit`).toMatch(unitPattern);
        }
      }
    }
  });
});
