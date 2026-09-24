import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __cspViolations?: Array<{
      blockedURI: string;
      effectiveDirective: string;
      violatedDirective: string;
    }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations?.push({
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective,
      });
    });
  });
});

test("hydrates an interaction without unexpected CSP violations", async ({ page }) => {
  test.setTimeout(90_000);
  const consoleViolations: string[] = [];
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /content security policy|refused to/i.test(message.text())
    ) {
      consoleViolations.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 60_000 });
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("script-src");
  expect(policy).toMatch(/'nonce-[^']+'/);
  if (process.env.PLAYWRIGHT_SERVER_MODE === "production") {
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("ws://localhost:3000");
  }
  expect(policy).toContain("frame-ancestors 'none'");

  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => window.__cspViolations ?? [])).toEqual([]);
  expect(consoleViolations).toEqual([]);
  expect(runtimeErrors).toEqual([]);

  const consentMessage = page.getByText(
    "We use analytics to understand how Agrocylo is used",
  );
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(consentMessage).not.toBeVisible();

  expect(await page.evaluate(() => window.__cspViolations ?? [])).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test("blocks an unrelated connection origin", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  test.setTimeout(90_000);

  const blocked = await page.evaluate(async () => {
    try {
      await fetch("https://unrelated.invalid/csp-probe");
      return false;
    } catch {
      return true;
    }
  });

  expect(blocked).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__cspViolations ?? []).some(
          (violation) =>
            violation.effectiveDirective === "connect-src" &&
            violation.blockedURI.includes("unrelated.invalid"),
        ),
      ),
    )
    .toBe(true);
});
