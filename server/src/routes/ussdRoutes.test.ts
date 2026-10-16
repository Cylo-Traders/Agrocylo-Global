import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("express", () => ({
  Router: vi.fn(() => ({
    post: vi.fn(),
  })),
}));

const { verifyProviderRequest } = await import("./ussdRoutes.js");

describe("verifyProviderRequest", () => {
  beforeEach(() => {
    delete process.env.USSD_PROVIDER_SECRET;
  });

  it("returns true when no USSD_PROVIDER_SECRET is set in environment", () => {
    const req = { headers: {} } as any;
    expect(verifyProviderRequest(req)).toBe(true);
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
