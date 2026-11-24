import { expect, test } from "@playwright/test";

/**
 * Mobile usability coverage for the product form and cart checkout (#1403).
 *
 * Runs at 320 CSS pixels — the narrowest supported viewport — and asserts the
 * two long flows stay usable without horizontal scrolling: the add/edit product
 * modal (form validation) and the multi-step checkout review.
 */

const BUYER_ADDRESS =
  "GBQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG5XYZ";

const freighterMock = `
  window.freighter = {
    isConnected:     () => Promise.resolve(true),
    getPublicKey:    () => Promise.resolve("${BUYER_ADDRESS}"),
    getNetwork:      () => Promise.resolve("TESTNET"),
    signTransaction: (xdr) => Promise.resolve({ signedTxXdr: xdr }),
  };
  window.freighterApi = window.freighter;
`;

const cartFixture = {
  cart_id: "cart_mobile",
  groups: [
    {
      farmer_wallet: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      farmer_name: "Green Farm",
      currency: "USDC",
      subtotal: "10000000",
      items: [
        {
          id: "item_mobile",
          product_id: "p1",
          name: "Wheat",
          quantity: "10",
          unit: "kg",
          unit_price: "1000000",
        },
      ],
    },
  ],
};

test.use({
  viewport: { width: 320, height: 568 },
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

test("market listing stays within a 320px viewport", async ({ page }) => {
  await page.goto("/market");
  await assertNoHorizontalOverflow(page);
  await expect(
    page.getByRole("heading", { name: /Discover and Trade/i }),
  ).toBeVisible();
});

test("add product form validates without horizontal scroll", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((address) => {
    localStorage.setItem("walletAddress", address);
    localStorage.setItem("walletNetwork", "Testnet");
  }, BUYER_ADDRESS);

  await page.goto("/dashboard/products");
  const addButton = page.getByRole("button", { name: /Add Product/i });
  await expect(addButton).toBeVisible({ timeout: 15_000 });
  await addButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Add Product")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  // Submitting an empty form surfaces validation instead of closing.
  await dialog.getByRole("button", { name: /List Product/i }).click();
  await expect(
    dialog.getByText(/Product name is required/i),
  ).toBeVisible();

  // Primary action stays reachable without covering the fields.
  await expect(
    dialog.getByRole("button", { name: /List Product/i }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await dialog.getByRole("button", { name: /Cancel/i }).click();
  await expect(dialog).not.toBeVisible();
});

test("checkout review is usable at 320px", async ({ page }) => {
  await page.route("**/cart", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cartFixture),
    });
  });

  await page.goto("/");
  await page.evaluate((address) => {
    localStorage.setItem("walletAddress", address);
    localStorage.setItem("walletNetwork", "Testnet");
  }, BUYER_ADDRESS);
  await page.reload();

  await page.getByRole("button", { name: "Open cart" }).click();

  // Step 1 — review.
  await expect(page.getByText("Wheat")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Green Farm")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  const proceed = page.getByRole("button", { name: /Proceed to Checkout/i });
  await expect(proceed).toBeVisible();
  await proceed.click();

  // Step 2 — confirm.
  await expect(page.getByLabel(/Delivery deadline/i)).toBeVisible();
  const confirm = page.getByRole("button", {
    name: /Confirm & Create Escrow Orders/i,
  });
  await expect(confirm).toBeVisible();
  await assertNoHorizontalOverflow(page);
});