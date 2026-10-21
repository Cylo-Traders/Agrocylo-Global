/// <reference types="vite/client" />
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import type { Router } from "express";
import { createRateLimitMock } from "./helpers/middlewareMocks.js";

// Every Prisma model method rejects, so handlers that reach the database
// answer 500 through the global error handler instead of hanging.
vi.mock("../db/client.js", () => {
  const model = new Proxy(
    {},
    { get: () => vi.fn().mockRejectedValue(new Error("db unavailable in routes.test")) },
  );
  return {
    prisma: new Proxy({}, { get: (_t, prop) => (String(prop).startsWith("$") ? model[prop as never] : model) }),
    connectDB: vi.fn(),
  };
});

vi.mock("../services/wsServer.js", () => ({
  broadcast: vi.fn(),
  getWsClientCount: vi.fn(() => 0),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
}));

vi.mock("../services/sorobanRpc.js", () => ({
  server: { getLatestLedger: vi.fn().mockRejectedValue(new Error("rpc unavailable")) },
}));

vi.mock("../middleware/rateLimit.js", () => createRateLimitMock());

import app from "../app.js";

/** Mount prefix per router file; anything not listed is mounted at /api/v1. */
const MOUNT_PREFIX: Record<string, string> = {
  indexer: "/api/v1/indexer",
};

const PLACEHOLDER_UUID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";

const routerModules = import.meta.glob<{ default: Router }>(["../routes/*.ts", "!../routes/*.test.ts"]);
const routerFiles = Object.keys(routerModules).map((p) => p.replace(/^\.\.\/routes\/(.*)\.ts$/, "$1"));

interface RouteLayer {
  route?: { path: unknown; methods: Record<string, boolean> };
}

async function routesOf(file: string): Promise<{ method: string; path: string }[]> {
  const mod = await routerModules[`../routes/${file}.ts`]!();
  const stack = (mod.default as unknown as { stack: RouteLayer[] }).stack;
  return stack.flatMap((layer) => {
    if (!layer.route || typeof layer.route.path !== "string") return [];
    const path = layer.route.path.replace(/:[A-Za-z_]+/g, PLACEHOLDER_UUID);
    return Object.keys(layer.route.methods).map((method) => ({ method, path }));
  });
}

/** True when the request fell through every router to the app's 404 handler. */
function isUnmounted(res: request.Response): boolean {
  return res.status === 404 && res.body?.error === "Not found";
}

describe("Route Registration", () => {
  it("discovers the router files under src/routes", () => {
    expect(routerFiles).toEqual(
      expect.arrayContaining(["campaigns", "orders", "transactions", "disputes", "notifications", "baskets"]),
    );
  });

  // Fails when a router file exists in src/routes but is never mounted in
  // app.ts (Issue #1204): delete the file or mount it.
  describe.each(routerFiles)("routes/%s.ts", (file) => {
    it("has every route reachable through app", async () => {
      const routes = await routesOf(file);
      expect(routes.length).toBeGreaterThan(0);

      const prefix = MOUNT_PREFIX[file] ?? "/api/v1";
      const unmounted: string[] = [];
      for (const { method, path } of routes) {
        const res = await (request(app) as unknown as Record<string, (url: string) => request.Test>)[method](
          `${prefix}${path}`,
        );
        if (isUnmounted(res)) unmounted.push(`${method.toUpperCase()} ${prefix}${path}`);
      }
      expect(unmounted).toEqual([]);
    });
  });

  it.each([
    "/api/v1/campaigns",
    "/api/v1/orders",
    "/api/v1/transactions",
    "/api/v1/disputes",
    "/api/v1/notifications",
    "/api/v1/notification-preferences",
    "/api/v1/baskets",
  ])("GET %s does not 404", async (path) => {
    const res = await request(app).get(path);
    expect(isUnmounted(res)).toBe(false);
  });

  it("should not have stale campaignRoutes mounted", async () => {
    const response = await request(app).get("/api/v1/campaigns-deprecated");
    expect(response.status).toBe(404);
  });

  it("should not have stale campaignController endpoints", async () => {
    const response = await request(app).post("/api/v1/campaigns/legacy-create");
    expect(response.status).toBe(404);
  });

  it("should have health endpoints available", async () => {
    const healthResponse = await request(app).get("/health");
    expect(healthResponse.status).toBe(200);

    const livezResponse = await request(app).get("/livez");
    expect(livezResponse.status).toBe(200);

    const readyzResponse = await request(app).get("/readyz");
    expect(readyzResponse.status).not.toBe(404);
  });
});
