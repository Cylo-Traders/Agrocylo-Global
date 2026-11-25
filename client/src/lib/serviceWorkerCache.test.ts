import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Issue #1475: load the real public/sw.js into a sandbox with fake Cache
 * Storage and run its activate handler, so the test covers the shipped policy.
 */
async function activateWith(existing: string[]) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const deleted: string[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  const sandbox = {
    self: {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        listeners[type] = fn;
      },
      clients: { claim: vi.fn() },
      location: { origin: "https://app.test" },
    },
    caches: {
      keys: async () => existing,
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    },
    console,
    URL,
  };
  runInNewContext(readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8"), sandbox);
  listeners.activate({ waitUntil: (p: Promise<unknown>) => (pending = p) });
  await pending;
  return { deleted, cacheName: runInNewContext("CACHE_NAME", sandbox) as string };
}

describe("service worker activation cache cleanup (#1475)", () => {
  it("uses an app-prefixed cache name", async () => {
    const { cacheName } = await activateWith([]);
    expect(cacheName).toMatch(/^agrocylo-sw-v\d+$/);
  });

  it("deletes obsolete caches owned by this app, including the legacy name", async () => {
    const { deleted } = await activateWith(["agrocylo-v1", "agrocylo-v2", "agrocylo-sw-v1"]);
    expect(deleted.sort()).toEqual(["agrocylo-sw-v1", "agrocylo-v1", "agrocylo-v2"]);
  });

  it("keeps the current cache and caches owned by other apps/features", async () => {
    const { cacheName } = await activateWith([]);
    const others = ["workbox-precache-v2", "other-app-v2", "agrocylo-images", "my-agrocylo-v2"];
    const { deleted } = await activateWith([cacheName, ...others]);
    expect(deleted).toEqual([]);
  });
});
