import { expect, test } from "@playwright/test";

test.describe("marketplace API journey", () => {
  test("browses, filters, opens a product, and returns to the filtered catalog", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    const productResponse = page.waitForResponse((response) =>
      response.url().includes("/api/v1/products") && response.request().method() === "GET",
    );

    await page.goto("/home");
    await page.getByRole("link", { name: "Browse marketplace" }).click();
    const response = await productResponse;
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          pricePerUnit: expect.any(String),
          amountUnit: "stroops",
          campaignId: expect.anything(),
          imageUrl: expect.anything(),
          isActive: expect.any(Boolean),
          isSellable: expect.any(Boolean),
        }),
      ]),
      meta: expect.objectContaining({ serviceVersion: expect.any(String) }),
    });
    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();
    await expect(page.getByRole("link", { name: /View .* XLM per/ }).first()).toBeVisible();

    const filteredRequest = page.waitForRequest((request) =>
      request.url().includes("/api/v1/products") && request.url().includes("category=VEGETABLES"),
    );
    await page.getByLabel("Category").selectOption("VEGETABLES");
    await expect(page.getByRole("status")).toContainText(/products available|No products found/);
    const filteredUrl = await filteredRequest;
    expect(filteredUrl.url()).toContain("category=VEGETABLES");

    await page.getByRole("link", { name: /View .* XLM per/ }).first().click();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test("validates minimum and maximum price filters together", async ({ page }) => {
    const productRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/products") && request.method() === "GET") {
        productRequests.push(request.url());
      }
    });

    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();

    const minInput = page.getByLabel(/min(imum)? price/i);
    const maxInput = page.getByLabel(/max(imum)? price/i);

    // Empty bounds remain optional: no error and no price filter sent.
    await minInput.fill("");
    await maxInput.fill("");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect
      .poll(() => productRequests.some((url) => url.includes("priceMin") || url.includes("priceMax")))
      .toBe(false);

    // Malformed (non-numeric) value produces an inline error and no request.
    const requestsBeforeMalformed = productRequests.length;
    await minInput.fill("abc");
    await expect(page.getByRole("alert")).toContainText(/price/i);
    await page.waitForTimeout(300);
    expect(productRequests.length).toBe(requestsBeforeMalformed);

    // Negative value produces an inline error and no request.
    await minInput.fill("-5");
    await expect(page.getByRole("alert")).toContainText(/price/i);
    await page.waitForTimeout(300);
    expect(productRequests.length).toBe(requestsBeforeMalformed);

    // Reversed range (min > max) produces an inline error and no request.
    await minInput.fill("100");
    await maxInput.fill("10");
    await expect(page.getByRole("alert")).toContainText(/minimum.*maximum|max.*min/i);
    await page.waitForTimeout(300);
    expect(productRequests.length).toBe(requestsBeforeMalformed);

    // Correcting the range clears the error and refreshes results with both bounds.
    const correctedRequest = page.waitForRequest((request) =>
      request.url().includes("/api/v1/products") &&
      request.url().includes("priceMin=10") &&
      request.url().includes("priceMax=100"),
    );
    await minInput.fill("10");
    await maxInput.fill("100");
    await expect(page.getByRole("alert")).toHaveCount(0);
    const correctedUrl = await correctedRequest;
    expect(correctedUrl.url()).toContain("priceMin=10");
    expect(correctedUrl.url()).toContain("priceMax=100");
  });
});
