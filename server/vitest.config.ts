import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      JWT_SECRET: "test-secret-at-least-32-chars-long!!",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/worker.ts"],
      thresholds: { lines: 40, functions: 35, branches: 25, statements: 38 },
      reporter: ["text", "lcov"],
    },
  },
});
