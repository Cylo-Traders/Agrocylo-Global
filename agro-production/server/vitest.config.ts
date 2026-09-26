import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The E2E suite boots a real HTTP server, WebSocket server, Prisma client,
    // `pg` pool, watcher intervals and a mock RPC server. Pulling it into the
    // unit run (and always defining DATABASE_URL below defeated its own skip
    // guard) is what kept the process alive after the suites finished
    // (issue #1064). It has its own config: `vitest.e2e.config.ts`.
    exclude: [...configDefaults.exclude, "src/e2e/**", "**/*.e2e.test.ts"],
    // Release shared resources after every suite and name the owner of any
    // handle that outlives it.
    setupFiles: ["./src/test/setup.ts"],
    // Fail fast instead of stalling a CI job on a handle we already know about.
    teardownTimeout: 10_000,
    hookTimeout: 20_000,
    globals: false,
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      RPC_URL: "https://soroban-testnet.stellar.org",
      JWT_SECRET: "test-secret-key-that-is-long-enough-for-validation-32chars",
      PRODUCTION_CONTRACT_ID: "test-production-contract",
      ESCROW_CONTRACT_ID: "test-escrow-contract",
      PRODUCTION_ESCROW_CONTRACT_ID: "test-production-contract",
      BASKET_CONTRACT_ID: "test-basket-contract",
    },
  },
});
