/**
 * Vitest global setup — runs once before any E2E test file.
 *
 * Ensures the test database schema is up-to-date by pushing the Prisma schema.
 * Requires E2E_DATABASE_URL to be set. If it is not set, E2E tests are skipped.
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "../../..");

export async function setup(): Promise<void> {
  const dbUrl = process.env["E2E_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!dbUrl) {
    console.warn(
      "[e2e/globalSetup] E2E_DATABASE_URL is not set — E2E tests will be skipped.\n" +
        "  Set E2E_DATABASE_URL=postgresql://... to enable them.",
    );
    return;
  }

  // Push the Prisma schema to the test database, resetting it completely.
  console.log("[e2e/globalSetup] Resetting test database schema...");
  execSync("npx prisma db push --force-reset --skip-generate", {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
  console.log("[e2e/globalSetup] Test database ready.");
}
