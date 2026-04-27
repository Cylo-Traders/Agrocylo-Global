import { test, expect, BrowserContext, Page } from "@playwright/test";

/**
 * Agrocylo Global – End-to-End Test Suite
 * Issue: #28  [Frontend] End-to-end testing
 *
 * Flows:
 *  1. Connect Wallet   → WalletButton.tsx / onboarding/ConnectWallet.tsx
 *  2. Create Listing   → ProductFormModal.tsx  (/dashboard/products)
 *  3. Purchase Item    → CreateOrderForm.tsx   (/orders/new)
 *  4. Confirm Delivery → OrderCard.tsx         (/orders)
 */

// ---------------------------------------------------------------------------
// Freighter wallet mock
// Injected before page load so window.freighter is always available.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Shared context — wallet state persists across all 4 tests
// ---------------------------------------------------------------------------
let context: BrowserContext;
let page: Page;

async function ensureWalletConnected(currentPage: Page) {
  const disconnectBtn = currentPage.getByRole("button", { name: "Disconnect" });
  if (await disconnectBtn.isVisible().catch(() => false)) {
    return;
  }

  await currentPage.evaluate((address) => {
    localStorage.setItem("walletAddress", address);
    localStorage.setItem("walletNetwork", "Testnet");
  }, FARMER_ADDRESS);

  await currentPage.reload();

  await expect(disconnectBtn).toBeVisible({ timeout: 10_000 });
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  await context.addInitScript(freighterMock);
  page = await context.newPage();
  await page.goto("/");
});

test.afterAll(async () => {
  await context.close();
});

// ---------------------------------------------------------------------------
// 1a. Connect Wallet — Navbar (WalletButton.tsx)
// "Connect Wallet" → click → button becomes "Disconnect"
// ---------------------------------------------------------------------------
test("1a – navbar WalletButton should connect Freighter wallet", async () => {
  const navConnectBtn = page.getByRole("button", { name: "Connect Wallet" });
  await expect(navConnectBtn).toBeVisible({ timeout: 10_000 });
  await navConnectBtn.click();

  // Connected state: button label switches to "Disconnect"
  await expect(
    page.getByRole("button", { name: "Disconnect" })
  ).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// 1b. Connect Wallet — Onboarding step (onboarding/ConnectWallet.tsx)
// "Connect Freighter Wallet" → address shown in mono → "Continue" appears
// ---------------------------------------------------------------------------
test("1b – onboarding ConnectWallet step should show address after connect", async () => {
  await page.goto("/onboarding");
  await ensureWalletConnected(page);

  // Truncated address rendered in a mono <p> (truncateAddress shows first 6 chars)
  await expect(
    page.locator("p.font-mono", { hasText: FARMER_ADDRESS.slice(0, 6) })
  ).toBeVisible({ timeout: 10_000 });

  // "Continue" button becomes available to advance to next onboarding step
  await expect(
    page.getByRole("button", { name: "Continue" })
  ).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// 2. Create Listing — ProductFormModal.tsx
// Route: /dashboard/products
// Open modal → fill all fields → "Create Product" → modal closes → item in grid
// ---------------------------------------------------------------------------
test("2 – farmer should create a new product listing", async () => {
  await page.goto("/dashboard/products");
  await ensureWalletConnected(page);

  // Trigger to open ProductFormModal in "add" mode
  const addBtn = page.getByRole("button", { name: /add product/i });
  await expect(addBtn).toBeVisible({ timeout: 10_000 });
  await addBtn.click();

  // Modal heading confirms mode === "add"
  await expect(
    page.getByRole("heading", { name: "Add Product" })
  ).toBeVisible({ timeout: 5_000 });

  // Product Name
  await page.getByLabel("Product Name").fill("Fresh Tomatoes");

  // Category select — first select with the disabled default option
  await page
    .locator("select")
    .filter({ hasText: "Select category" })
    .selectOption("Vegetables");

  // Price per unit
  await page.getByLabel("Price").fill("5.00");

  // Currency select — options are STRK / USDC
  await page
    .locator("select")
    .filter({ hasText: /STRK/ })
    .selectOption("USDC");

  // Unit select — options: kg, bag, crate, piece, litre, dozen (keep default "kg")

  // Fill required logistics fields
  await page.getByLabel("Farm Location (Region)").fill("Kumasi, Ghana");
  await page.getByLabel("Delivery Window").fill("2-3 days");

  // Description textarea
  await page
    .getByPlaceholder("Tell buyers about origin, organic status, or health benefits...")
    .fill("Organic sun-ripened tomatoes.");

  // Submit
  await page.getByRole("button", { name: "List Product" }).click();

  // Modal closes after onSuccess + onClose
  await expect(
    page.getByRole("heading", { name: "Add Product" })
  ).not.toBeVisible({ timeout: 15_000 });

  // Back on dashboard after modal closes
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// 3. Purchase Item — CreateOrderForm.tsx
// Route: /orders/new?farmer=<FARMER_ADDRESS>
// Fields: Farmer Address (pre-filled), Amount (XLM), description textarea
// Submit: "Confirm & Create Order" → success heading: "Order Created"
// ---------------------------------------------------------------------------
test("3 – buyer should purchase an item (escrow funded)", async () => {
  await page.goto(`/orders/new?farmer=${FARMER_ADDRESS}`);
  await ensureWalletConnected(page);

  // Farmer address is pre-filled from the query param
  await expect(page.getByLabel("Farmer Address")).toHaveValue(FARMER_ADDRESS, {
    timeout: 10_000,
  });

  // Amount (XLM)
  await page.getByLabel("Amount (XLM)").fill("10");

  // Description — placeholder: "e.g. 50kg organic tomatoes"
  await page
    .getByPlaceholder("e.g. 50kg organic tomatoes")
    .fill("50kg Fresh Tomatoes");

  // Fee breakdown becomes visible once amount > 0
  await expect(page.getByText("Platform fee (3%)")).toBeVisible();
  await expect(page.getByText("Farmer receives")).toBeVisible();

  // Submit
  await page.getByRole("button", { name: "Confirm & Create Order" }).click();

  // Freighter mock signs → success card shows "Order Created"
  await expect(
    page.getByRole("heading", { name: "Order Created" })
  ).toBeVisible({ timeout: 20_000 });

  // TX hash rendered in mono paragraph
  await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// 4. Confirm Delivery — OrderCard.tsx
// Route: /orders
// Finds a Pending order card → clicks "Confirm Receipt"
// → status badge updates to "Completed"
// ---------------------------------------------------------------------------
test("4 – buyer should confirm delivery and release escrow", async () => {
  await page.goto("/orders");
  await ensureWalletConnected(page);

  // OrderCard renders as a rounded-xl div; find first one with "Pending" badge
  const pendingCard = page
    .locator("div.rounded-xl")
    .filter({ hasText: "Pending" })
    .first();

  await expect(pendingCard).toBeVisible({ timeout: 10_000 });

  // "Confirm Receipt" button is rendered only when isBuyer=true & status=Pending
  const confirmBtn = pendingCard.getByRole("button", {
    name: "Confirm Receipt",
  });
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();

  // After escrow release, a Completed status badge is shown
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 20_000 });
});