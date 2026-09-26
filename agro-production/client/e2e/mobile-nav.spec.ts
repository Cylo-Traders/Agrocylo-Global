import { expect, test } from "@playwright/test";

/**
 * Issue #1056: the navigation used to be a single fixed-height row, which
 * overflowed narrow viewports. These specs pin the 320px behaviour: the
 * collapsible menu, keyboard operation, focus return, and the wallet control
 * staying reachable while the menu is closed.
 */

const narrow = { width: 320, height: 640 };

test.describe("mobile navigation at 320px", () => {
  test.use({ viewport: narrow });

  test("collapses the primary links behind an accessible toggle", async ({ page }) => {
    await page.goto("/home");

    const toggle = page.getByRole("button", { name: /open navigation menu/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // No horizontal overflow at the narrowest supported width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const panelId = await toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    await expect(page.locator(`#${panelId}`)).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`#${panelId}`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Marketplace" })).toBeVisible();
  });

  test("closes on Escape and returns focus to the toggle", async ({ page }) => {
    await page.goto("/home");

    const toggle = page.getByRole("button", { name: /open navigation menu/i });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  });

  test("keeps the wallet control reachable while the menu is closed", async ({ page }) => {
    await page.goto("/home");

    const wallet = page.getByRole("button", { name: /connect|wallet/i }).first();
    await expect(wallet).toBeVisible();

    const box = await wallet.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(narrow.width);
  });
});

test.describe("desktop navigation", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("shows the links inline without a menu toggle", async ({ page }) => {
    await page.goto("/home");

    await expect(page.getByRole("link", { name: "Marketplace" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: /open navigation menu/i })).toBeHidden();
  });
});
