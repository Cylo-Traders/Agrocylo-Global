import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { setAccessToken } from "@/lib/authToken";

// Capture the fetch inputs the ApiClient issues, with the real client (no
// mocks) so base URL assembly and auth attachment are verified end to end.
const fetchMock = vi.fn();

import { fetchOrderById } from "@/services/orderService";

const ORDER = {
  id: "o-1",
  onChainId: "pending",
  campaignId: "c-1",
  buyerAddress: "GBP7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7X",
  amount: "100000000",
  status: "PENDING",
  ledger: 7,
  txHash: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-type", "application/json"]]),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("fetchOrderById (#1052)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    setAccessToken(null);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls the configured API base under /orders/:id (no same-origin guesswork)", async () => {
    fetchMock.mockResolvedValueOnce(okJson(ORDER));

    await fetchOrderById("order-123");

    const [url] = fetchMock.mock.calls[0]! as [string, unknown];
    expect(url).toMatch(/\/orders\/order-123$/);
    expect(url).not.toContain("localhost:3000/api/orders");
  });

  it("attaches the wallet access token as a Bearer header", async () => {
    setAccessToken("test-token");
    fetchMock.mockResolvedValueOnce(okJson(ORDER));

    await fetchOrderById("order-123");

    const [, init] = fetchMock.mock.calls[0]! as [string, { headers: Record<string, string> }];
    expect(init.headers["Authorization"]).toBe("Bearer test-token");
  });

  it("sanitizes the order id before building the path", async () => {
    fetchMock.mockResolvedValueOnce(okJson(ORDER));

    await fetchOrderById("../treacherous");

    const [url] = fetchMock.mock.calls[0]! as [string, unknown];
    expect(url).toMatch(/\/orders\/treacherous$/);
  });

  it("surfaces a 403 as an ApiError (forbidden state, no order leak)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: new Map([["content-type", "application/json"]]),
      json: () => Promise.resolve({ title: "Forbidden" }),
    } as unknown as Response);

    await expect(fetchOrderById("order-123")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
    });
  });

  it("surfaces a 404 as an ApiError (not-found state)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Map([["content-type", "application/json"]]),
      json: () => Promise.resolve({ title: "Order Not Found" }),
    } as unknown as Response);

    await expect(fetchOrderById("order-123")).rejects.toMatchObject({ status: 404 });
  });

  it("maps connection failures to NetworkError (offline state)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(fetchOrderById("order-123")).rejects.toMatchObject({
      name: "NetworkError",
    });
  });
});
