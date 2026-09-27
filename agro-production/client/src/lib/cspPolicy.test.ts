/**
 * CSP construction, nonce handling and observability origins (#1039, #1040).
 */
import { describe, it, expect } from "vitest";
import {
  buildContentSecurityPolicy,
  generateCspNonce,
  isValidCspNonce,
  observabilityConnectSources,
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

describe("observabilityConnectSources (#1040)", () => {
  it("includes the Sentry origin for a valid HTTPS DSN", () => {
    const { origins } = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: "https://abc123@o1.ingest.sentry.io/12345",
      NODE_ENV: "production",
    });
    expect(origins).toEqual(["https://o1.ingest.sentry.io"]);
  });

  it("includes the telemetry origin only when telemetry is enabled", () => {
    const enabled = observabilityConnectSources({
      NEXT_PUBLIC_TELEMETRY_ENABLED: "true",
      NEXT_PUBLIC_TELEMETRY_URL: "https://telemetry.example.com/v1/ingest",
      NODE_ENV: "production",
    });
    expect(enabled.origins).toContain("https://telemetry.example.com");

    const disabled = observabilityConnectSources({
      NEXT_PUBLIC_TELEMETRY_ENABLED: "false",
      NEXT_PUBLIC_TELEMETRY_URL: "https://telemetry.example.com/v1/ingest",
      NODE_ENV: "production",
    });
    expect(disabled.origins).toHaveLength(0);
  });

  // An unset observability variable must not widen the policy.
  it("does not widen the policy when nothing is configured", () => {
    const { origins, rejected } = observabilityConnectSources({ NODE_ENV: "production" });
    expect(origins).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it("rejects a non-HTTPS DSN in production", () => {
    const { origins, rejected } = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: "http://o1.ingest.sentry.io/1",
      NODE_ENV: "production",
    });
    expect(origins).toHaveLength(0);
    expect(rejected).toEqual(["NEXT_PUBLIC_SENTRY_DSN"]);
  });

  it("allows http://localhost only outside production", () => {
    const dev = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: "http://localhost:9000/1",
      NODE_ENV: "development",
    });
    expect(dev.origins).toEqual(["http://localhost:9000"]);

    const prod = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: "http://localhost:9000/1",
      NODE_ENV: "production",
    });
    expect(prod.origins).toHaveLength(0);
  });

  it("rejects a DSN carrying credentials", () => {
    const { origins, rejected } = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: "https://user:pass@o1.ingest.sentry.io/1",
      NODE_ENV: "production",
    });
    expect(origins).toHaveLength(0);
    expect(rejected).toEqual(["NEXT_PUBLIC_SENTRY_DSN"]);
  });

  it("rejects malformed URLs and names the variable without echoing it", () => {
    const { origins, rejected } = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: "not a url",
      NODE_ENV: "production",
    });
    expect(origins).toHaveLength(0);
    expect(rejected).toEqual(["NEXT_PUBLIC_SENTRY_DSN"]);
  });

  it("strips path, query and fragment from the origin", () => {
    const { origins } = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: "https://key@o1.ingest.sentry.io/12345?x=1#frag",
      NODE_ENV: "production",
    });
    expect(origins).toEqual(["https://o1.ingest.sentry.io"]);
  });

  it("de-duplicates when Sentry and telemetry share an origin", () => {
    const { origins } = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: "https://o1.ingest.sentry.io/1",
      NEXT_PUBLIC_TELEMETRY_ENABLED: "true",
      NEXT_PUBLIC_TELEMETRY_URL: "https://o1.ingest.sentry.io/v1",
      NODE_ENV: "production",
    });
    expect(origins).toEqual(["https://o1.ingest.sentry.io"]);
  });

  it("feeds the observability origins into connect-src", () => {
    const { origins } = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: "https://o1.ingest.sentry.io/1",
      NODE_ENV: "production",
    });
    const policy = buildContentSecurityPolicy({ ...base, nonce: NONCE, observabilitySources: origins });
    expect(directive(policy, "connect-src")).toContain("https://o1.ingest.sentry.io");
  });

  it("does not add an observability origin to connect-src when unset", () => {
    const { origins } = observabilityConnectSources({ NODE_ENV: "production" });
    const policy = buildContentSecurityPolicy({ ...base, nonce: NONCE, observabilitySources: origins });
    expect(directive(policy, "connect-src")).toBe(
      directive(buildContentSecurityPolicy({ ...base, nonce: NONCE }), "connect-src"),
    );
  });
});
