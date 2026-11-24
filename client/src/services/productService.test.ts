import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { listProducts } from "./productService";
import { ApiRequestError } from "@/lib/apiHelper";

describe("productService.listProducts", () => {
  const originalFetch = global.fetch;
  const originalDemo = process.env.NEXT_PUBLIC_DEMO_MODE;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DEMO_MODE = originalDemo;
  });

  it("returns demo fixtures when demo mode is enabled", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    global.fetch = vi.fn();
    const result = await listProducts({ page: 1, pageSize: 24 });
    expect(result.items.length).toBeGreaterThan(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("surfaces network errors from apiRequest", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(listProducts()).rejects.toMatchObject({ name: "ApiRequestError", code: "NETWORK_ERROR" });
  });
});
