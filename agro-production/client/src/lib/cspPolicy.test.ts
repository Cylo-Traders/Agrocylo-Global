/**
 * CSP construction and nonce handling (issue #1039) — tests.
 */
import { describe, it, expect } from "vitest";
import {
  buildContentSecurityPolicy,
  generateCspNonce,
  isValidCspNonce,
} from "./cspPolicy";

const NONCE = "AAAAAAAAAAAAAAAAAAAAAA==";

const base = {
  isProduction: true,
  imageSources: ["https://ipfs.io"],
  connectSources: ["https://soroban-testnet.stellar.org"],
};

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))?.slice(name.length + 1);
}

describe("buildContentSecurityPolicy", () => {
  describe("nonce for hydration (#1039)", () => {
    it("adds the nonce to script-src when one is supplied", () => {
      const policy = buildContentSecurityPolicy({ ...base, nonce: NONCE });
      expect(directive(policy, "script-src")).toContain(`'nonce-${NONCE}'`);
    });

    it("adds the nonce to style-src so critical CSS is not blocked", () => {
      const policy = buildContentSecurityPolicy({ ...base, nonce: NONCE });
      expect(directive(policy, "style-src")).toContain(`'nonce-${NONCE}'`);
    });

    // The whole point of the nonce: the policy must not fall back to
    // 'unsafe-inline' for scripts.
    it("never adds unsafe-inline to script-src, with or without a nonce", () => {
      expect(directive(buildContentSecurityPolicy({ ...base, nonce: NONCE }), "script-src")).not.toContain(
        "'unsafe-inline'",
      );
      expect(directive(buildContentSecurityPolicy({ ...base, nonce: null }), "script-src")).not.toContain(
        "'unsafe-inline'",
      );
    });

    it("omits the nonce when none is supplied", () => {
      expect(directive(buildContentSecurityPolicy({ ...base, nonce: null }), "script-src")).not.toContain("nonce-");
    });

    it("ignores a malformed nonce rather than emitting it into the header", () => {
      const policy = buildContentSecurityPolicy({ ...base, nonce: "bad' nonce; script-src *' });
      expect(policy).not.toContain("script-src *");
      expect(directive(policy, "script-src")).not.toContain("nonce-");
    });
  });

  describe("directives", () => {
    it("keeps frame-ancestors, base-uri and form-action locked down", () => {
      const policy = buildContentSecurityPolicy({ ...base, nonce: NONCE });
      expect(directive(policy, "frame-ancestors")).toBe("'none'");
      expect(directive(policy, "base-uri")).toBe("'self'");
      expect(directive(policy, "form-action")).toBe("'self'");
    });

    it("adds object-src and upgrade-insecure-requests in production only", () => {
      expect(buildContentSecurityPolicy({ ...base, nonce: NONCE })).toContain("object-src 'none'");
      expect(buildContentSecurityPolicy({ ...base, nonce: NONCE })).toContain("upgrade-insecure-requests");
      expect(buildContentSecurityPolicy({ ...base, isProduction: false, nonce: NONCE })).not.toContain(
        "object-src",
      );
    });

    it("always includes self in img-src and connect-src", () => {
      const policy = buildContentSecurityPolicy({ ...base, nonce: NONCE });
      expect(directive(policy, "img-src")?.startsWith("'self'")).toBe(true);
      expect(directive(policy, "connect-src")?.startsWith("'self'")).toBe(true);
    });

    it("de-duplicates repeated sources", () => {
      const policy = buildContentSecurityPolicy({
        ...base,
        nonce: NONCE,
        imageSources: ["https://ipfs.io", "https://ipfs.io"],
      });
      const img = directive(policy, "img-src") ?? "";
      expect(img.split("https://ipfs.io").length - 1).toBe(1);
    });
  });
});

describe("isValidCspNonce", () => {
  it("accepts a base64 nonce of reasonable length", () => {
    expect(isValidCspNonce(NONCE)).toBe(true);
    expect(isValidCspNonce(generateCspNonce())).toBe(true);
  });

  it("rejects values that could break out of the header", () => {
    for (const bad of ["", "'", "a b", "a;script-src *", "<script>", "A".repeat(8)]) {
      expect(isValidCspNonce(bad)).toBe(false);
    }
  });

  it("rejects null and undefined", () => {
    expect(isValidCspNonce(null)).toBe(false);
    expect(isValidCspNonce(undefined)).toBe(false);
  });
});

describe("generateCspNonce", () => {
  it("produces a distinct value each call", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateCspNonce()));
    expect(values.size).toBe(20);
  });
});
