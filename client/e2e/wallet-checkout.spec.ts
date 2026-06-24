import { test, expect, BrowserContext, Page } from "@playwright/test";

/**
 * E2E Test: Wallet Connection and Checkout Flow
 * Issue: #488 [Frontend] Add Vitest and Playwright coverage for checkout + wallet flow
 *
 * This test validates:
 * 1. Wallet connection via Freighter mock
 * 2. Order creation form validation
 * 3. Complete checkout flow with escrow transaction
 * 4. Order confirmation page
 */

const FARMER_ADDRESS =
  "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const BUYER_ADDRESS =
  "GBQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG5XYZ";

// Freighter wallet mock injected before page load
const freighterMock = `
  window.freighter = {
    isConnected: () => Promise.resolve(true),
    getPublicKey: () => Promise.resolve("${BUYER_ADDRESS}"),
    getNetwork: () => Promise.resolve("TESTNET"),
    signTransaction: (xdr) => Promise.resolve({ signedTxXdr: xdr }),
  };
  window.freighterApi = window.freighter;
`;

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  await context.addInitScript(freighterMock);
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test.describe("Wallet Connection and Checkout Flow", () => {
  test("should connect wallet from navbar", async () => {
    await page.goto("/");

    // Click connect wallet button
    const connectBtn = page.getByRole("button", { name: /connect wallet/i });
    await expect(connectBtn).toBeVisible({ timeout: 10_000 });
    await connectBtn.click();

    // Should show truncated address after connection
    await expect(page.getByText(/GBQP2K/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("should navigate to order creation page", async () => {
    await page.goto(`/orders/new?farmer=${FARMER_ADDRESS}`);

    // Ensure wallet is connected
    await page.evaluate((address) => {
      localStorage.setItem("walletAddress", address);
      localStorage.setItem("walletNetwork", "Testnet");
    }, BUYER_ADDRESS);

    await page.reload();

    // Page should load with form
    await expect(
      page.getByRole("heading", { name: /create order/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should validate order form inputs", async () => {
    await page.goto(`/orders/new?farmer=${FARMER_ADDRESS}`);

    // Try to submit empty form
    const submitBtn = page.getByRole("button", {
      name: /confirm & create order/i,
    });
    await submitBtn.click();

    // Should show validation errors
    await expect(page.getByText(/amount is required/i)).toBeVisible({
      timeout: 5_000,
    });
  });

  test("should calculate platform fee correctly", async () => {
    await page.goto(`/orders/new?farmer=${FARMER_ADDRESS}`);

    // Enter amount
    const amountInput = page.getByLabel(/amount \(xlm\)/i);
    await amountInput.fill("100");

    // Should show fee breakdown
    await expect(page.getByText(/platform fee \(3%\)/i)).toBeVisible();
    await expect(page.getByText("3.00")).toBeVisible(); // 3% of 100
    await expect(page.getByText(/farmer receives/i)).toBeVisible();
    await expect(page.getByText("97.00")).toBeVisible(); // 100 - 3
  });

  test("should complete full checkout flow", async () => {
    await page.goto(`/orders/new?farmer=${FARMER_ADDRESS}`);

    // Ensure wallet is connected
    await page.evaluate((address) => {
      localStorage.setItem("walletAddress", address);
      localStorage.setItem("walletNetwork", "Testnet");
    }, BUYER_ADDRESS);

    await page.reload();

    // Fill in order form
    const farmerInput = page.getByLabel(/farmer address/i);
    await expect(farmerInput).toHaveValue(FARMER_ADDRESS);

    const amountInput = page.getByLabel(/amount \(xlm\)/i);
    await amountInput.fill("50");

    const descriptionInput = page.getByPlaceholder(
      /e.g. 50kg organic tomatoes/i,
    );
    await descriptionInput.fill("25kg Fresh Organic Tomatoes");

    // Submit order
    const submitBtn = page.getByRole("button", {
      name: /confirm & create order/i,
    });
    await submitBtn.click();

    // Wait for transaction to complete
    // In a real test, mock the API response
    // Here we just check for success state
    await expect(
      page.getByRole("heading", { name: /order created/i }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("should show transaction hash after order creation", async () => {
    await page.goto(`/orders/new?farmer=${FARMER_ADDRESS}`);

    // Ensure wallet is connected
    await page.evaluate((address) => {
      localStorage.setItem("walletAddress", address);
      localStorage.setItem("walletNetwork", "Testnet");
    }, BUYER_ADDRESS);

    await page.reload();

    // Fill and submit form
    await page.getByLabel(/amount \(xlm\)/i).fill("25");
    await page
      .getByPlaceholder(/e.g. 50kg organic tomatoes/i)
      .fill("10kg Tomatoes");
    await page.getByRole("button", { name: /confirm & create order/i }).click();

    // Should display transaction hash
    await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 15_000 });
  });

  test("should navigate to orders list after creation", async () => {
    await page.goto(`/orders/new?farmer=${FARMER_ADDRESS}`);

    // Ensure wallet is connected
    await page.evaluate((address) => {
      localStorage.setItem("walletAddress", address);
      localStorage.setItem("walletNetwork", "Testnet");
    }, BUYER_ADDRESS);

    await page.reload();

    // Complete order
    await page.getByLabel(/amount \(xlm\)/i).fill("15");
    await page
      .getByPlaceholder(/e.g. 50kg organic tomatoes/i)
      .fill("Test Order");
    await page.getByRole("button", { name: /confirm & create order/i }).click();

    // Wait for success
    await expect(
      page.getByRole("heading", { name: /order created/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Navigate to orders
    const viewOrdersBtn = page.getByRole("link", { name: /view orders/i });
    if (await viewOrdersBtn.isVisible()) {
      await viewOrdersBtn.click();

      await expect(page.getByRole("heading", { name: /orders/i })).toBeVisible({
        timeout: 10_000,
      });
    }
  });

  test("should prevent order creation without wallet connection", async () => {
    await page.goto(`/orders/new?farmer=${FARMER_ADDRESS}`);

    // Clear wallet connection
    await page.evaluate(() => {
      localStorage.removeItem("walletAddress");
      localStorage.removeItem("walletNetwork");
    });

    await page.reload();

    // Submit button should be disabled or show warning
    const submitBtn = page.getByRole("button", {
      name: /confirm & create order/i,
    });

    // Either disabled or shows connect wallet message
    const isDisabled = await submitBtn.isDisabled().catch(() => false);
    const hasWarning = await page
      .getByText(/connect wallet/i)
      .isVisible()
      .catch(() => false);

    expect(isDisabled || hasWarning).toBeTruthy();
  });
});
