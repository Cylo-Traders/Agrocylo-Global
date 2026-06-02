import { expect, test } from "@playwright/test";

const FARMER_ADDRESS =
  "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const freighterMock = `
  window.freighter = {
    isConnected:     () => Promise.resolve(true),
    getPublicKey:    () => Promise.resolve("${FARMER_ADDRESS}"),
    getNetwork:      () => Promise.resolve("TESTNET"),
    signTransaction: (xdr) => Promise.resolve({ signedTxXdr: xdr }),
  };
  window.freighterApi = window.freighter;
`;

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(freighterMock);
});

async function assertNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

test("public pages keep a mobile-safe layout and nav", async ({ page }) => {
  await page.goto("/");
  await assertNoHorizontalOverflow(page);

  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Marketplace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();

  await page.goto("/market");
  await assertNoHorizontalOverflow(page);

  await page.goto("/about");
  await assertNoHorizontalOverflow(page);
});

test("dashboard shell keeps mobile navigation accessible", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((address) => {
    localStorage.setItem("walletAddress", address);
    localStorage.setItem("walletNetwork", "Testnet");
  }, FARMER_ADDRESS);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Products" })).toBeVisible();
});
