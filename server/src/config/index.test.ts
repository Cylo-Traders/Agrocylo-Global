import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

function setRequiredEnv(overrides: NodeJS.ProcessEnv = {}) {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    PORT: "5000",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    JWT_SECRET: "test-secret-at-least-32-chars-long!!",
    ...overrides,
  };
}

async function importFreshConfig() {
  vi.resetModules();
  return import("./index.js");
}

describe("environment validation", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("fails startup validation when JWT_SECRET is missing", async () => {
    setRequiredEnv({ JWT_SECRET: undefined });
    delete process.env["JWT_SECRET"];

    await expect(importFreshConfig()).rejects.toThrow(/JWT_SECRET/);
  });

  it("loads config when required environment variables are valid", async () => {
    setRequiredEnv();

    const { config } = await importFreshConfig();

    expect(config.jwtSecret).toBe("test-secret-at-least-32-chars-long!!");
    expect(config.nodeEnv).toBe("test");
  });

  it.each(["METRICS_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"])("fails production startup when %s is missing", async (key) => {
    setRequiredEnv({ NODE_ENV: "production", ALLOWED_ORIGINS: "https://app.example.com", METRICS_API_KEY: "secret", SUPABASE_SERVICE_ROLE_KEY: "secret", INTEGRATOR_API_KEY_PEPPER: "production-integrator-pepper-at-least-32-chars", [key]: "" });
    await expect(importFreshConfig()).rejects.toThrow(new RegExp(key));
  });

  it("rejects non-HTTPS production origins", async () => {
    setRequiredEnv({ NODE_ENV: "production", ALLOWED_ORIGINS: "http://app.example.com", METRICS_API_KEY: "secret", SUPABASE_SERVICE_ROLE_KEY: "secret", INTEGRATOR_API_KEY_PEPPER: "production-integrator-pepper-at-least-32-chars" });
    await expect(importFreshConfig()).rejects.toThrow(/ALLOWED_ORIGINS/);
  });
});
