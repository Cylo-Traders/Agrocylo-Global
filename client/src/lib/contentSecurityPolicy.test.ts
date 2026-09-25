import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "./contentSecurityPolicy";

const env = {
  NEXT_PUBLIC_API_URL: "http://localhost:5000/api",
  NEXT_PUBLIC_SOROBAN_RPC_URL: "https://rpc.example.test/rpc",
  NEXT_PUBLIC_HORIZON_URL: "https://horizon.example.test",
  NEXT_PUBLIC_ANALYTICS_ENDPOINT: "https://analytics.example.test/events",
  NEXT_PUBLIC_SENTRY_DSN: "https://key@errors.example.test/123",
};

describe("buildContentSecurityPolicy", () => {
  it("allows only the configured HTTP and WebSocket connection origins", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "test-nonce",
      isDevelopment: false,
      requestOrigin: "https://marketplace.example.test",
      env,
    });

    expect(policy).toContain(
      "connect-src 'self' http://localhost:5000 ws://localhost:5000 https://rpc.example.test https://horizon.example.test https://analytics.example.test https://errors.example.test",
    );
    expect(policy).not.toContain("unrelated.example.test");
    expect(policy).not.toContain("connect-src *");
  });

  it("keeps unsafe-eval and the exact HMR WebSocket origin development-only", () => {
    const development = buildContentSecurityPolicy({
      nonce: "dev-nonce",
      isDevelopment: true,
      requestOrigin: "http://localhost:3000",
      env,
    });
    const production = buildContentSecurityPolicy({
      nonce: "prod-nonce",
      isDevelopment: false,
      requestOrigin: "https://marketplace.example.test",
      env,
    });

    expect(development).toContain("'nonce-dev-nonce'");
    expect(development).toContain("'unsafe-eval'");
    expect(development).toContain("ws://localhost:3000");
    expect(production).toContain("'nonce-prod-nonce'");
    expect(production).not.toContain("'unsafe-eval'");
    expect(production).not.toContain("wss://marketplace.example.test");
  });

  it("retains framing and executable-object restrictions", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "prod-nonce",
      isDevelopment: false,
      requestOrigin: "https://marketplace.example.test",
      env,
    });

    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
  });
});
