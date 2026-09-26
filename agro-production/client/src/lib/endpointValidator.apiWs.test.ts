import { describe, it, expect } from "vitest";
import { validateApiWsOrigins, assertApiWsOriginsValid } from "./endpointValidator";

describe("validateApiWsOrigins (Issue #1001)", () => {
  it("returns null origins with no errors when both are unset (same-origin deployment)", () => {
    const result = validateApiWsOrigins({ NODE_ENV: "production" }, { isProduction: true });
    expect(result.errors).toEqual([]);
    expect(result.origins).toEqual({ api: null, ws: null });
  });

  it("accepts separate https/wss origins in production", () => {
    const result = validateApiWsOrigins(
      {
        NEXT_PUBLIC_API_URL: "https://api.example.com",
        NEXT_PUBLIC_WS_URL: "wss://ws.example.com",
        NODE_ENV: "production",
      },
      { isProduction: true }
    );
    expect(result.errors).toEqual([]);
    expect(result.origins).toEqual({ api: "https://api.example.com", ws: "wss://ws.example.com" });
  });

  it("accepts http/ws on localhost in development", () => {
    const result = validateApiWsOrigins(
      {
        NEXT_PUBLIC_API_URL: "http://localhost:5001",
        NEXT_PUBLIC_WS_URL: "ws://localhost:5001",
        NODE_ENV: "development",
      },
      { isProduction: false }
    );
    expect(result.errors).toEqual([]);
    expect(result.origins).toEqual({ api: "http://localhost:5001", ws: "ws://localhost:5001" });
  });

  it("rejects http:// for a non-local API host", () => {
    const result = validateApiWsOrigins(
      { NEXT_PUBLIC_API_URL: "http://api.example.com", NODE_ENV: "production" },
      { isProduction: true }
    );
    expect(result.invalidVars).toContain("NEXT_PUBLIC_API_URL");
    expect(result.origins.api).toBeNull();
  });

  it("rejects ws:// for a non-local WS host", () => {
    const result = validateApiWsOrigins(
      { NEXT_PUBLIC_WS_URL: "ws://ws.example.com", NODE_ENV: "production" },
      { isProduction: true }
    );
    expect(result.invalidVars).toContain("NEXT_PUBLIC_WS_URL");
    expect(result.origins.ws).toBeNull();
  });

  it("rejects a malformed API URL", () => {
    const result = validateApiWsOrigins(
      { NEXT_PUBLIC_API_URL: "not-a-url", NODE_ENV: "development" },
      { isProduction: false }
    );
    expect(result.invalidVars).toContain("NEXT_PUBLIC_API_URL");
  });

  it("rejects an API URL with embedded credentials", () => {
    const result = validateApiWsOrigins(
      { NEXT_PUBLIC_API_URL: "https://user:pass@api.example.com", NODE_ENV: "production" },
      { isProduction: true }
    );
    expect(result.invalidVars).toContain("NEXT_PUBLIC_API_URL");
  });

  it("rejects an https:// value for NEXT_PUBLIC_WS_URL (wrong scheme family)", () => {
    const result = validateApiWsOrigins(
      { NEXT_PUBLIC_WS_URL: "https://ws.example.com", NODE_ENV: "production" },
      { isProduction: true }
    );
    expect(result.invalidVars).toContain("NEXT_PUBLIC_WS_URL");
  });

  it("drops query strings and paths, keeping only the origin", () => {
    const result = validateApiWsOrigins(
      { NEXT_PUBLIC_API_URL: "https://api.example.com:8443/v1?token=secret", NODE_ENV: "production" },
      { isProduction: true }
    );
    expect(result.origins.api).toBe("https://api.example.com:8443");
  });
});

describe("assertApiWsOriginsValid (Issue #1001)", () => {
  it("throws a variable-named error without echoing the raw value", () => {
    expect(() =>
      assertApiWsOriginsValid(
        { NEXT_PUBLIC_API_URL: "http://user:pass@api.example.com", NODE_ENV: "production" },
        { isProduction: true }
      )
    ).toThrow(/NEXT_PUBLIC_API_URL/);
  });

  it("returns exact origins on success", () => {
    const result = assertApiWsOriginsValid(
      { NEXT_PUBLIC_API_URL: "https://api.example.com", NEXT_PUBLIC_WS_URL: "wss://ws.example.com", NODE_ENV: "production" },
      { isProduction: true }
    );
    expect(result).toEqual({ apiOrigin: "https://api.example.com", wsOrigin: "wss://ws.example.com" });
  });
});