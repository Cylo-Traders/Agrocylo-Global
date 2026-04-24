import { defineConfig, devices } from "@playwright/test";

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
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
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
    command: "npm run dev -- --host 0.0.0.0 --port 3000",
    url: "http://127.0.0.1:3000",
    cwd: ".",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
