import { afterEach, describe, expect, it, vi } from "vitest";
import { revalidateCartStock } from "./productService";

function product(overrides: Record<string, unknown>) {
  return {
    id: "p1",
    farmer_wallet: "G",
    name: "Wheat",
    description: null,
    category: "Grains",
    price_per_unit: "1",
    currency: "USDC",
    unit: "kg",
    stock_quantity: "100",
    image_url: null,
    location: "Accra",
    delivery_window: "2 days",
    is_available: true,
    ...overrides,
  };
}

function mockProducts(map: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const id = url.split("/products/")[1]?.split(/[?#]/)[0] ?? "";
      if (!(id in map)) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify(map[id]), { status: 200 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("revalidateCartStock", () => {
  it("returns no issues when live stock and availability are fine", async () => {
    mockProducts({ p1: product({ stock_quantity: "100" }) });
    const issues = await revalidateCartStock([
      { product_id: "p1", name: "Wheat", quantity: "10" },
    ]);
    expect(issues).toEqual([]);
  });

  it("flags a listing that is no longer available", async () => {
    mockProducts({ p1: product({ is_available: false }) });
    const issues = await revalidateCartStock([
      { product_id: "p1", name: "Wheat", quantity: "1" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toBe("unavailable");
  });

  it("flags insufficient stock", async () => {
    mockProducts({ p1: product({ stock_quantity: "5" }) });
    const issues = await revalidateCartStock([
      { product_id: "p1", name: "Wheat", quantity: "10" },
    ]);
    expect(issues[0].reason).toBe("insufficient_stock");
    expect(issues[0].availableStock).toBe(5);
    expect(issues[0].message).toContain("Only 5");
  });

  it("flags out-of-stock items", async () => {
    mockProducts({ p1: product({ stock_quantity: "0" }) });
    const issues = await revalidateCartStock([
      { product_id: "p1", name: "Wheat", quantity: "1" },
    ]);
    expect(issues[0].reason).toBe("out_of_stock");
  });

  it("treats a missing product as not_found", async () => {
    mockProducts({});
    const issues = await revalidateCartStock([
      { product_id: "gone", name: "Wheat", quantity: "1" },
    ]);
    expect(issues[0].reason).toBe("not_found");
  });

  it("does not block checkout when the re-check itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const issues = await revalidateCartStock([
      { product_id: "p1", name: "Wheat", quantity: "1" },
    ]);
    expect(issues).toEqual([]);
  });

  it("sums duplicate product quantities before comparing to stock", async () => {
    mockProducts({ p1: product({ stock_quantity: "15" }) });
    const issues = await revalidateCartStock([
      { product_id: "p1", name: "Wheat", quantity: "10" },
      { product_id: "p1", name: "Wheat", quantity: "10" },
    ]);
    expect(issues[0].reason).toBe("insufficient_stock");
    expect(issues[0].requestedQuantity).toBe(20);
  });
});