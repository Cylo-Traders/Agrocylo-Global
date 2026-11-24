import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("API contract coverage", () => {
  const root = path.resolve(__dirname, "../../../");
  const spec = fs.readFileSync(path.join(root, "server/openapi.yaml"), "utf8");

  it("covers core marketplace endpoints", () => {
    for (const p of ["/products", "/products/{id}", "/cart", "/cart/items/{id}", "/cart/checkout"]) {
      expect(spec).toContain(`${p}:`);
    }
  });

  it("documents auth-protected error responses used by client", () => {
    expect(spec).toContain("x-wallet-address");
    expect(spec).toContain("'401': { description: Unauthorized }");
  });
});
