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
});
