import { describe, expect, it, beforeEach } from "vitest";
import {
  configureIdempotencyStore,
  getCachedResponse,
  setCachedResponse,
  clearIdempotencyCache,
  isBodyMismatch,
  type IdempotencyStore,
} from "./idempotency.js";

/** Minimal in-test store so the module-level accessors can be exercised. */
function makeStore(): IdempotencyStore & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    async get(key) {
      return (entries.get(key) as never) ?? null;
    },
    async set(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    },
  };
}

describe("idempotency cache accessors", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
    configureIdempotencyStore(store);
  });

  it("round-trips a cached response", async () => {
    await setCachedResponse("k1", 201, { ok: true });
    const cached = await getCachedResponse("k1");
    expect(cached?.status).toBe(201);
    expect(cached?.body).toEqual({ ok: true });
  });

  it("returns null for an unknown key", async () => {
    expect(await getCachedResponse("nope")).toBeNull();
  });

  it("clears a key", async () => {
    await setCachedResponse("k2", 200, { ok: true });
    await clearIdempotencyCache("k2");
    expect(await getCachedResponse("k2")).toBeNull();
  });

  it("flags a body mismatch on the same key", async () => {
    await setCachedResponse("k3", 200, { amount: 10 });
    const cached = await getCachedResponse("k3");
    expect(cached).not.toBeNull();
    expect(isBodyMismatch(cached!, { amount: 10 })).toBe(false);
    expect(isBodyMismatch(cached!, { amount: 11 })).toBe(true);
  });
});
