import { expect, test } from "@playwright/test";

/**
 * Issue #1090: unknown URLs used to fall through to Next's unbranded 404.
 * They now render app/not-found.tsx inside the normal shell. The route error
 * boundary (app/error.tsx) is covered by src/app/__tests__/boundaries.test.tsx,
 * since no production route throws on demand.
 */

test.describe("app-level not-found boundary", () => {
  test("renders the branded 404 inside the app shell", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    // Still inside the root layout: the main navigation is present.
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();

    const links = page.getByRole("navigation", { name: "Helpful links" });
    await expect(links.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/home");
    await expect(links.getByRole("link", { name: "Browse the marketplace" })).toBeVisible();
  });

  test("its links navigate back into the app", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await page
      .getByRole("navigation", { name: "Helpful links" })
      .getByRole("link", { name: "View campaigns" })
      .click();
    await expect(page).toHaveURL(/\/campaigns$/);
  });
});
