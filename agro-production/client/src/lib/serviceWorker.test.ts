import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

interface TestFetchEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

function loadFetchHandler(fetchImpl: typeof fetch = globalThis.fetch) {
  const handlers: Record<string, (event: TestFetchEvent) => void> = {};
  const self = {
    location: { origin: "https://agro.example" },
    clients: { claim: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, handler: (event: TestFetchEvent) => void) => { handlers[type] = handler; },
  };
  const cache = { match: vi.fn(), put: vi.fn(), addAll: vi.fn() };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => []),
    match: vi.fn(async () => new Response("offline shell")),
    delete: vi.fn(),
  };
  const workerPath = process.cwd().endsWith("agro-production/client")
    ? resolve(process.cwd(), "public/sw.js")
    : resolve(process.cwd(), "agro-production/client/public/sw.js");
  const source = readFileSync(workerPath, "utf8");
  runInNewContext(source, { self, caches, fetch: fetchImpl, Response, URL });
  return { handler: handlers.fetch!, cache };
}

describe("service worker cache boundaries", () => {
  it.each([
    ["GET", "https://agro.example/api/v1/products", "cors"],
    ["GET", "https://agro.example/orders", "cors"],
    ["POST", "https://agro.example/transactions", "cors"],
    ["GET", "https://rpc.stellar.org/soroban", "cors"],
  ])("does not cache sensitive request %s %s", (method, url, mode) => {
    const { handler } = loadFetchHandler();
    const respondWith = vi.fn();

    handler({ request: { url, method, mode } as Request, respondWith });

    expect(respondWith).not.toHaveBeenCalled();
  });

  it("handles an offline navigation through the offline shell", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    const { handler } = loadFetchHandler(fetchMock);
    const respondWith = vi.fn();
    handler({ request: { url: "https://agro.example/marketplace", method: "GET", mode: "navigate" } as Request, respondWith });

    await expect(respondWith.mock.calls[0][0]).resolves.toBeInstanceOf(Response);
  });

  it("caches immutable build assets", () => {
    const { handler } = loadFetchHandler(vi.fn().mockResolvedValue(new Response("chunk")));
    const respondWith = vi.fn();
    handler({ request: { url: "https://agro.example/_next/static/chunks/app.js", method: "GET", mode: "no-cors" } as Request, respondWith });

    expect(respondWith).toHaveBeenCalledOnce();
  });
});
