import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs against a real, migrated database in a dedicated CI job — excluded
    // here so the regular (mocked, infra-free) unit test suite stays fast.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "src/prisma.integration.test.ts",
    ],
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      JWT_SECRET: "test-secret-at-least-32-chars-long!!",
      INTEGRATOR_API_KEY_PEPPER: "test-integrator-pepper-at-least-32-chars",
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
