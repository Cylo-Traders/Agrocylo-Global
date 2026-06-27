import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/e2e/**/*.e2e.test.ts"],
    globalSetup: ["./src/e2e/globalSetup.ts"],
    // Sequential — tests share DB state across suites within one file.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Pass through test DB URL so the global setup can read it.
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      // DATABASE_URL is set from E2E_DATABASE_URL (or the shell env) in globalSetup.
      ...(process.env["E2E_DATABASE_URL"]
        ? { DATABASE_URL: process.env["E2E_DATABASE_URL"] }
        : {}),
    },
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      // Allow the E2E test to import from the server src without .js extensions.
      "@server": path.resolve(__dirname, "src"),
    },
  },
});
