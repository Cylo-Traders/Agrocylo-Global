import { defineConfig } from "vitest/config";

// Runs only the tests that exercise the real generated Prisma client against
// a live, migrated database (see .github/workflows/ci.yml "server-integration"
// job). Kept separate from vitest.config.ts so the default mocked unit test
// suite stays infra-free.
export default defineConfig({
  test: {
    include: ["src/prisma.integration.test.ts"],
  },
});
