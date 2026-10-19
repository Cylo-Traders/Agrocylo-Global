import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("express", () => ({
  Router: vi.fn(() => ({
    post: vi.fn(),
  })),
}));

const { verifyProviderRequest } = await import("./ussdRoutes.js");

describe("verifyProviderRequest", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.USSD_PROVIDER_SECRET;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("fails closed when USSD_PROVIDER_SECRET is unset in production", () => {
    process.env.NODE_ENV = "production";
    const req = { headers: {} } as any;
    expect(verifyProviderRequest(req)).toBe(false);
  });

  it("fails closed when USSD_PROVIDER_SECRET is unset even if a header is provided", () => {
    process.env.NODE_ENV = "production";
    const req = { headers: { "x-ussd-provider-secret": "anything" } } as any;
    expect(verifyProviderRequest(req)).toBe(false);
  });

  it("returns true when request header matches USSD_PROVIDER_SECRET", () => {
    process.env.USSD_PROVIDER_SECRET = "secret-key-123";
    const req = { headers: { "x-ussd-provider-secret": "secret-key-123" } } as any;
    expect(verifyProviderRequest(req)).toBe(true);
  });

  it("returns false when request header is missing or incorrect", () => {
    process.env.USSD_PROVIDER_SECRET = "secret-key-123";
    const req = { headers: { "x-ussd-provider-secret": "wrong-secret" } } as any;
    expect(verifyProviderRequest(req)).toBe(false);
  });
});
