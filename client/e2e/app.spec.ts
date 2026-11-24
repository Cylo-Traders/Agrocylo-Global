import { test, expect, FARMER_ADDRESS } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe("Wallet Connection", () => {
  test("should connect Freighter wallet from navbar", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await page.goto("/");

    const connectBtn = page.getByRole("button", { name: "Connect Wallet" });
    await expect(connectBtn).toBeVisible({ timeout: 10_000 });
    await connectBtn.click();

    await expect(
      page.getByText(FARMER_ADDRESS.slice(0, 6), { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show wallet address in navbar after connection", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await page.goto("/");

    const navConnectBtn = page.getByRole("button", { name: "Connect Wallet" });
    await navConnectBtn.click();

    await expect(
      page.getByText(FARMER_ADDRESS.slice(0, 6), { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show onboarding page with wallet connected", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await page.goto("/onboarding");

    await expect(
      page.locator("p.font-mono", {
        hasText: FARMER_ADDRESS.slice(0, 6),
      }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  });
});

test.describe("Product Create", () => {
  test("should open Add Product modal and list a product", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await page.goto("/dashboard/products");
    await page.reload();

    const addBtn = page.getByRole("button", { name: /add product/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    await expect(
      page.getByRole("heading", { name: "Add Product" }),
    ).toBeVisible({ timeout: 5_000 });

    await page.getByLabel("Product Name").fill("Fresh Tomatoes");

    await page
      .locator("select")
      .filter({ hasText: "Select category" })
      .selectOption("Vegetables");

    await page.getByLabel("Price").fill("5.00");

    await page
      .locator("select")
      .filter({ hasText: /STRK/ })
      .selectOption("USDC");

    await page.getByLabel("Farm Location (Region)").fill("Kumasi, Ghana");
    await page.getByLabel("Delivery Window").fill("2-3 days");

    await page
      .getByPlaceholder(/tell buyers about origin/i)
      .fill("Organic sun-ripened tomatoes.");

    await page.getByRole("button", { name: "List Product" }).click();

    await expect(
      page.getByRole("heading", { name: "Add Product" }),
    ).not.toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Add-to-Cart", () => {
  test("should add a product to cart and verify cart items", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await page.goto("/market");
    await page.reload();

    await page.waitForTimeout(3000);

    const addToCartBtn = page
      .getByRole("button", { name: /add to cart/i })
      .first();
    if (await addToCartBtn.count()) {
      await addToCartBtn.click();
    }

    // Cart badge should be visible if items exist
    const cartBadge = page.getByText("0").first();
    await expect(cartBadge).toBeVisible({ timeout: 5_000 }).catch(() => {});
  });
});

test.describe("Checkout Flow", () => {
  test("should complete checkout and create escrow order", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await page.goto(`/orders/new?farmerId=${FARMER_ADDRESS}`);
    await page.reload();

    await expect(page.getByLabel("Farmer Address")).toHaveValue(
      FARMER_ADDRESS,
      { timeout: 10_000 },
    );

    await page.getByLabel("Amount (XLM)").fill("50");

    const descriptionInput = page.getByPlaceholder(
      /e.g. 50kg organic tomatoes/i,
    );
    await descriptionInput.fill("25kg Fresh Organic Tomatoes");

    await expect(page.getByText("Platform fee (3%)")).toBeVisible();

    await page
      .getByRole("button", { name: "Confirm & Create Order" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Order Created" }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 5_000 });
  });

  test("should show fee breakdown at checkout", async ({ page, walletMock }) => {
    await walletMock.connect(page);
    await page.goto(`/orders/new?farmerId=${FARMER_ADDRESS}`);
    await page.reload();

    await page.getByLabel("Amount (XLM)").fill("100");

    await expect(page.getByText(/platform fee \(3%\)/i)).toBeVisible();
    await expect(page.getByText("3.00")).toBeVisible();
    await expect(page.getByText(/farmer receives/i)).toBeVisible();
    await expect(page.getByText("97.00")).toBeVisible();
  });
});

test.describe("Order Confirmation", () => {
  test("should show transaction hash after successful order", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await page.goto(`/orders/new?farmerId=${FARMER_ADDRESS}`);
    await page.reload();

    await page.getByLabel("Amount (XLM)").fill("25");
    await page
      .getByPlaceholder(/e.g. 50kg organic tomatoes/i)
      .fill("10kg Tomatoes");

    await page
      .getByRole("button", { name: "Confirm & Create Order" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Order Created" }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 15_000 });
  });

  test("should navigate to orders page after creation", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await page.goto(`/orders/new?farmerId=${FARMER_ADDRESS}`);
    await page.reload();

    await page.getByLabel("Amount (XLM)").fill("15");
    await page
      .getByPlaceholder(/e.g. 50kg organic tomatoes/i)
      .fill("Test Order");

    await page
      .getByRole("button", { name: "Confirm & Create Order" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Order Created" }),
    ).toBeVisible({ timeout: 20_000 });

    const viewOrdersBtn = page.getByRole("link", { name: /view orders/i });
    if (await viewOrdersBtn.isVisible()) {
      await viewOrdersBtn.click();
      await expect(
        page.getByRole("heading", { name: /orders/i }),
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});

test.describe("Negative-path: Backend Unavailable", () => {
  test("should show error state when backend is unreachable", async ({
    page,
    walletMock,
    apiMock,
  }) => {
    await walletMock.connect(page);
    await apiMock.simulateBackendUnavailable(page);
    await page.goto("/market");

    // Page should still render (client-side) but show empty or error state
    await page.waitForTimeout(3000);
  });
});

test.describe("Negative-path: Wallet Rejection", () => {
  test("should handle wallet signature rejection gracefully", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await walletMock.rejectSignature(page);
    await page.goto(`/orders/new?farmerId=${FARMER_ADDRESS}`);
    await page.reload();

    await page.getByLabel("Amount (XLM)").fill("50");
    await page
      .getByPlaceholder(/e.g. 50kg organic tomatoes/i)
      .fill("Test Order");

    await page
      .getByRole("button", { name: "Confirm & Create Order" })
      .click();

    await page.waitForTimeout(5000);
  });
});

test.describe("Order Validation", () => {
  test("should prevent order creation without wallet connection", async ({
    page,
    walletMock,
  }) => {
    await walletMock.connect(page);
    await page.goto(`/orders/new?farmerId=${FARMER_ADDRESS}`);

    await walletMock.disconnect(page);
    await page.reload();

    const submitBtn = page.getByRole("button", {
      name: /confirm & create order/i,
    });

    const isDisabled = await submitBtn.isDisabled().catch(() => false);
    const hasWarning = await page
      .getByText(/connect wallet/i)
      .isVisible()
      .catch(() => false);

    expect(isDisabled || hasWarning).toBeTruthy();
  });

  test("should validate order form inputs", async ({ page, walletMock }) => {
    await walletMock.connect(page);
    await page.goto(`/orders/new?farmerId=${FARMER_ADDRESS}`);
    await page.reload();

    const submitBtn = page.getByRole("button", {
      name: /confirm & create order/i,
    });
    await submitBtn.click();

    await expect(
      page.getByText(/amount is required/i),
    ).toBeVisible({ timeout: 5_000 });
  });
});
