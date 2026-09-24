import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const serverPort =
  new URL(baseURL).port || (baseURL.startsWith("https:") ? "443" : "80");
const isProductionServer = process.env.PLAYWRIGHT_SERVER_MODE === "production";
const serverCommand = isProductionServer
  ? `npm run build -- --webpack && npm run start -- --port ${serverPort}`
  : `npm run dev -- --port ${serverPort}`;

/**
 * Agrocylo Global – Playwright Configuration
 * Issue: #28
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox",  use: { ...devices["Desktop Firefox"] } },
  ],

  webServer: {
    command: serverCommand,
    cwd: __dirname,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { NEXT_PUBLIC_DEMO_MODE: "true" },
  },
});