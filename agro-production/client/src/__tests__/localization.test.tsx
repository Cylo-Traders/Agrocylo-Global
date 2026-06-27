import { describe, it, expect } from "vitest";
import enMessages from "../messages/en.json";
import frMessages from "../messages/fr.json";

describe("Localization", () => {
  it("has all required English translations", () => {
    expect(enMessages.common).toBeDefined();
    expect(enMessages.wallet).toBeDefined();
    expect(enMessages.marketplace).toBeDefined();
    expect(enMessages.notifications).toBeDefined();
    expect(enMessages.orders).toBeDefined();
    expect(enMessages.dashboard).toBeDefined();
  });

  it("has all required French translations", () => {
    expect(frMessages.common).toBeDefined();
    expect(frMessages.wallet).toBeDefined();
    expect(frMessages.marketplace).toBeDefined();
    expect(frMessages.notifications).toBeDefined();
    expect(frMessages.orders).toBeDefined();
    expect(frMessages.dashboard).toBeDefined();
  });

  it("has matching keys between English and French", () => {
    const enKeys = Object.keys(enMessages);
    const frKeys = Object.keys(frMessages);
    
    expect(enKeys.sort()).toEqual(frKeys.sort());
  });

  it("has matching nested keys for common section", () => {
    const enCommonKeys = Object.keys(enMessages.common);
    const frCommonKeys = Object.keys(frMessages.common);
    
    expect(enCommonKeys.sort()).toEqual(frCommonKeys.sort());
  });

  it("has matching nested keys for wallet section", () => {
    const enWalletKeys = Object.keys(enMessages.wallet);
    const frWalletKeys = Object.keys(frMessages.wallet);
    
    expect(enWalletKeys.sort()).toEqual(frWalletKeys.sort());
  });

  it("has matching nested keys for marketplace section", () => {
    const enMarketplaceKeys = Object.keys(enMessages.marketplace);
    const frMarketplaceKeys = Object.keys(frMessages.marketplace);
    
    expect(enMarketplaceKeys.sort()).toEqual(frMarketplaceKeys.sort());
  });

  it("has no empty translation values in English", () => {
    const checkEmpty = (obj: Record<string, any>, path = ""): string[] => {
      const empty: string[] = [];
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof value === "string" && value.trim() === "") {
          empty.push(currentPath);
        } else if (typeof value === "object" && value !== null) {
          empty.push(...checkEmpty(value, currentPath));
        }
      }
      return empty;
    };

    const emptyKeys = checkEmpty(enMessages);
    expect(emptyKeys).toEqual([]);
  });

  it("has no empty translation values in French", () => {
    const checkEmpty = (obj: Record<string, any>, path = ""): string[] => {
      const empty: string[] = [];
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof value === "string" && value.trim() === "") {
          empty.push(currentPath);
        } else if (typeof value === "object" && value !== null) {
          empty.push(...checkEmpty(value, currentPath));
        }
      }
      return empty;
    };

    const emptyKeys = checkEmpty(frMessages);
    expect(emptyKeys).toEqual([]);
  });
});
