import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetProductGraphData = vi.fn();
const mockListProducts = vi.fn();
const mockGetGraphOrder = vi.fn();
const mockGetAllForWallet = vi.fn();
const mockGetProfileGraphData = vi.fn();

vi.mock("./productService.js", () => ({
  getProductGraphData: (...args: any[]) => mockGetProductGraphData(...args),
  listProducts: (...args: any[]) => mockListProducts(...args),
}));

vi.mock("./orderService.js", () => ({
  OrderService: {
    getGraphOrder: (...args: any[]) => mockGetGraphOrder(...args),
    getAllForWallet: (...args: any[]) => mockGetAllForWallet(...args),
  },
}));

vi.mock("./profileService.js", () => ({
  getProfileGraphData: (...args: any[]) => mockGetProfileGraphData(...args),
}));

import { executeGraphQL, MAX_DEPTH, MAX_ALIAS_COUNT, MAX_QUERY_SIZE } from "./graphqlGatewayService.js";

const WALLET_A = "GA" + "A".repeat(55);
const WALLET_B = "GB" + "B".repeat(55);
const WALLET_ADMIN = "GADMIN" + "A".repeat(50);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProductGraphData.mockResolvedValue({ id: "prod-1", name: "Maize" });
  mockListProducts.mockResolvedValue({ items: [], total: 0 });
  mockGetAllForWallet.mockResolvedValue([{ orderIdOnChain: "order-1", buyerAddress: WALLET_A }]);
  mockGetProfileGraphData.mockResolvedValue({ profile: { wallet_address: WALLET_A } });
  mockGetGraphOrder.mockResolvedValue({
    orderIdOnChain: "order-123",
    buyerAddress: WALLET_A,
    sellerAddress: "GSELLER" + "S".repeat(48),
  });
});

describe("GraphQL Gateway — IDOR protection", () => {
  it("authenticated as A, orders(wallet: B) → denied (403)", async () => {
    const query = `{ orders(wallet: "${WALLET_B}") { id } }`;
    const result = await executeGraphQL(query, {}, WALLET_A);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toMatch(/access|Forbidden/i);
    expect(mockGetAllForWallet).not.toHaveBeenCalled();
  });

  it("authenticated as A, orders via variables wallet: B → denied", async () => {
    const query = `query Q($w: String) { orders(wallet: $w) { id } }`;
    const result = await executeGraphQL(query, { w: WALLET_B }, WALLET_A);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toMatch(/access|Forbidden/i);
    expect(mockGetAllForWallet).not.toHaveBeenCalled();
  });

  it("authenticated as A, profile(wallet: B) → denied", async () => {
    const query = `{ profile(wallet: "${WALLET_B}") { id } }`;
    const result = await executeGraphQL(query, {}, WALLET_A);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toMatch(/access|Forbidden/i);
    expect(mockGetProfileGraphData).not.toHaveBeenCalled();
  });

  it("profile with wallet_address arg also denied for non-admin", async () => {
    const query = `{ profile(wallet_address: "${WALLET_B}") { id } }`;
    const result = await executeGraphQL(query, {}, WALLET_A);
    expect(result.errors).toBeDefined();
    expect(mockGetProfileGraphData).not.toHaveBeenCalled();
  });

  it("orders without wallet arg returns own wallet's orders", async () => {
    const query = `{ orders { id } }`;
    const result = await executeGraphQL(query, {}, WALLET_A);
    expect(result.errors).toBeUndefined();
    expect(mockGetAllForWallet).toHaveBeenCalledWith(WALLET_A);
    expect(result.data.orders).toBeDefined();
  });

  it("profile without wallet arg returns own profile", async () => {
    const query = `{ profile { id } }`;
    const result = await executeGraphQL(query, {}, WALLET_A);
    expect(result.errors).toBeUndefined();
    expect(mockGetProfileGraphData).toHaveBeenCalledWith(WALLET_A);
  });

  it("admin caller can request another wallet's orders", async () => {
    const query = `{ orders(wallet: "${WALLET_B}") { id } }`;
    const result = await executeGraphQL(query, {}, WALLET_ADMIN, "ADMIN");
    expect(result.errors).toBeUndefined();
    expect(mockGetAllForWallet).toHaveBeenCalledWith(WALLET_B);
  });

  it("admin caller can request another wallet's profile", async () => {
    const query = `{ profile(wallet: "${WALLET_B}") { id } }`;
    const result = await executeGraphQL(query, {}, WALLET_ADMIN, "ADMIN");
    expect(result.errors).toBeUndefined();
    expect(mockGetProfileGraphData).toHaveBeenCalledWith(WALLET_B);
  });

  it("non-admin with different case wallet still denied (case-insensitive)", async () => {
    const query = `{ orders(wallet: "${WALLET_B.toLowerCase()}") { id } }`;
    const result = await executeGraphQL(query, {}, WALLET_A);
    expect(result.errors).toBeDefined();
    expect(mockGetAllForWallet).not.toHaveBeenCalled();
  });

  it("singular order checks ownership — non-owner gets 403", async () => {
    const query = `{ order(id: "order-123") { id } }`;
    // Mock order belongs to A, but caller is B
    mockGetGraphOrder.mockResolvedValueOnce({
      orderIdOnChain: "order-123",
      buyerAddress: WALLET_A,
      sellerAddress: "GSELLERxxx",
    });
    const result = await executeGraphQL(query, {}, WALLET_B);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toMatch(/access|Forbidden/i);
  });

  it("singular order — admin can view any order", async () => {
    const query = `{ order(id: "order-123") { id } }`;
    mockGetGraphOrder.mockResolvedValueOnce({
      orderIdOnChain: "order-123",
      buyerAddress: WALLET_A,
      sellerAddress: "GSELLERxxx",
    });
    const result = await executeGraphQL(query, {}, WALLET_ADMIN, "ADMIN");
    expect(result.errors).toBeUndefined();
    expect(result.data.order).toBeDefined();
  });

  it("matrix: every per-user field respects cross-wallet denial", async () => {
    const fields = [
      `{ orders(wallet: "${WALLET_B}") { id } }`,
      `{ profile(wallet: "${WALLET_B}") { id } }`,
      `{ orders(walletAddress: "${WALLET_B}") { id } }`,
      `{ profile(walletAddress: "${WALLET_B}") { id } }`,
      `{ orders(wallet_address: "${WALLET_B}") { id } }`,
      `{ profile(wallet_address: "${WALLET_B}") { id } }`,
      `{ orders(id: "${WALLET_B}") { id } }`,
      `{ profile(id: "${WALLET_B}") { id } }`,
    ];
    for (const q of fields) {
      vi.clearAllMocks();
      mockGetAllForWallet.mockResolvedValue([]);
      mockGetProfileGraphData.mockResolvedValue({ profile: {} });
      const result = await executeGraphQL(q, {}, WALLET_A);
      expect(result.errors, `field ${q} should be denied`).toBeDefined();
    }
  });
});

describe("GraphQL Gateway — DoS protections", () => {
  it("depth bomb is rejected with 400", async () => {
    // Build a query deeper than MAX_DEPTH (8). Each level adds 1 depth via nested selection.
    // Our schema only has top-level fields, but we can still nest via alias + selectionSet:
    // e.g. { a: product(id: "1") { farmer { wallet_address } } } — but product returns JSON scalar, so no subfields?
    // Instead we craft a query with fragments that inflate depth.
    // Simpler: use inline fragments repeatedly to increase depth count.
    let deep = "product(id: \"1\")";
    // Wrap with fragments to exceed depth
    // Create 10 levels of inline fragments
    let query = "{ ";
    for (let i = 0; i < MAX_DEPTH + 2; i++) {
      query += `level${i}: product(id: "1") `;
      query += "{ ".repeat(1);
    }
    // Actually simpler: use repeated selection sets via aliases with nested braces that our depth calculator counts.
    // Our depth calculator counts any Field with selectionSet as +1, so { a { b { c } } } would be depth 3 even if a is product.
    // Since product is JSON scalar, it shouldn't have subfields per schema, but validation will fail before depth.
    // For depth test, we need a query that is valid per schema but still deep. We can use multiple top-level fields with aliases and fragments.
    // Easiest: create a query with many nested fragments that exceed depth via fragment spreads.
    const fragmentDepthQuery = `
      fragment F1 on Query { product(id: "1") }
      fragment F2 on Query { ...F1 }
      fragment F3 on Query { ...F2 }
      fragment F4 on Query { ...F3 }
      fragment F5 on Query { ...F4 }
      fragment F6 on Query { ...F5 }
      fragment F7 on Query { ...F6 }
      fragment F8 on Query { ...F7 }
      fragment F9 on Query { ...F8 }
      query { ...F9 }
    `;
    // This should be >8 depth due to fragment chain
    await expect(executeGraphQL(fragmentDepthQuery, {}, WALLET_A)).rejects.toMatchObject({ status: 400 });
  });

  it("alias explosion is rejected with 400", async () => {
    // Generate >MAX_ALIAS_COUNT aliases for the same field
    const aliases = Array.from({ length: MAX_ALIAS_COUNT + 5 }, (_, i) => `alias${i}: product(id: "1")`).join(" ");
    const query = `{ ${aliases} }`;
    await expect(executeGraphQL(query, {}, WALLET_A)).rejects.toMatchObject({ status: 400 });
  });

  it("query exceeding max size is rejected with 400", async () => {
    const bigQuery = `{ product(id: "${"a".repeat(MAX_QUERY_SIZE)}") }`;
    expect(bigQuery.length).toBeGreaterThan(MAX_QUERY_SIZE);
    await expect(executeGraphQL(bigQuery, {}, WALLET_A)).rejects.toMatchObject({ status: 400 });
  });

  it("valid query passes depth/cost checks", async () => {
    const query = `{ product(id: "prod-1") }`;
    const result = await executeGraphQL(query, {}, WALLET_A);
    expect(result.errors).toBeUndefined();
    expect(mockGetProductGraphData).toHaveBeenCalledWith("prod-1");
  });

  it("unsupported field is rejected with 400 via schema validation", async () => {
    const query = `{ unsupportedField }`;
    await expect(executeGraphQL(query, {}, WALLET_A)).rejects.toMatchObject({ status: 400 });
  });
});

describe("GraphQL Gateway — uses real graphql-js engine", () => {
  it("exposes a published schema SDL", async () => {
    const { getSchemaSDL, graphQLSchema } = await import("./graphqlGatewayService.js");
    const sdl = getSchemaSDL();
    expect(sdl).toContain("type Query");
    expect(sdl).toContain("product");
    expect(sdl).toContain("orders");
    expect(sdl).toContain("profile");
    expect(graphQLSchema).toBeDefined();
  });

  it("rejects malformed GraphQL syntax with 400", async () => {
    const query = `{ product(id: ) }`; // syntax error
    await expect(executeGraphQL(query, {}, WALLET_A)).rejects.toMatchObject({ status: 400 });
  });

  it("handles variables substitution correctly for allowed field", async () => {
    const query = `query Q($pid: String) { product(id: $pid) }`;
    const result = await executeGraphQL(query, { pid: "prod-var" }, WALLET_A);
    expect(result.errors).toBeUndefined();
    expect(mockGetProductGraphData).toHaveBeenCalledWith("prod-var");
  });
});
