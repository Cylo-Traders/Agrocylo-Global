import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * Issue #1483: load the real public/sw.js into a sandbox and dispatch push
 * events, so the test covers the shipped payload handling.
 */
async function pushWith(data: { json: () => unknown } | null) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  const sandbox = {
    self: {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        listeners[type] = fn;
      },
      location: { origin: "https://app.test" },
      registration: {
        showNotification: async (title: string, options: Record<string, unknown>) => {
          shown.push({ title, options });
        },
      },
    },
    console,
    URL,
  };
  runInNewContext(readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8"), sandbox);
  listeners.push({ data, waitUntil: (p: Promise<unknown>) => (pending = p) });
  await pending;
  return shown;
}

const payload = (value: unknown) => ({ json: () => value });
const malformed = {
  json: () => {
    throw new SyntaxError("Unexpected token");
  },
};
const generic = {
  title: "Cylo Global",
  options: expect.objectContaining({
    body: "You have a new notification.",
    icon: "/icon-192x192.svg",
    data: "/",
  }),
};

describe("service worker push payloads (#1483)", () => {
  it("renders a valid payload's title, body and internal target", async () => {
    const shown = await pushWith(
      payload({ title: "Order shipped", body: "Your order is on its way", url: "/orders/7" }),
    );
    expect(shown).toEqual([
      {
        title: "Order shipped",
        options: expect.objectContaining({
          body: "Your order is on its way",
          icon: "/icon-192x192.svg",
          data: "/orders/7",
        }),
      },
    ]);
  });

  it("shows a generic notification for an empty payload", async () => {
    expect(await pushWith(null)).toEqual([generic]);
  });

  it("shows a generic notification instead of throwing on malformed JSON", async () => {
    expect(await pushWith(malformed)).toEqual([generic]);
  });

  it("ignores payloads that are not objects or carry non-string fields", async () => {
    for (const value of [null, "text", ["a"], 7, { title: 42, body: { x: 1 }, url: ["/x"] }]) {
      expect(await pushWith(payload(value))).toEqual([generic]);
    }
  });

  it("keeps an external url out of the notification target", async () => {
    const shown = await pushWith(payload({ title: "Hi", url: "https://evil.test/x" }));
    expect(shown[0].options.data).toBe("/");
  });
});
