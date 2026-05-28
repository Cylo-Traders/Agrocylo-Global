import { createServer } from "http";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WsServer } from "../wsServer.js";
import type { WsEnvelope, ProductionUpdatePayload } from "../wsServer.js";

function getPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const addr = s.address() as { port: number };
      s.close(() => resolve(addr.port));
    });
  });
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<WsEnvelope> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()) as WsEnvelope);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("WsServer", () => {
  let httpServer: ReturnType<typeof createServer>;
  let wsServer: WsServer;
  let port: number;

  beforeEach(async () => {
    port = await getPort();
    httpServer = createServer();
    wsServer = new WsServer(httpServer);
    await new Promise<void>((r) => httpServer.listen(port, r));
  });

  afterEach(async () => {
    await wsServer.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("broadcast sends correct envelope shape", async () => {
    const client = await connectClient(port);
    const msgPromise = nextMessage(client);

    const payload: ProductionUpdatePayload = {
      productionId: "prod-1",
      farmerId: "farmer-1",
      status: "harvested",
      updatedAt: new Date().toISOString(),
    };

    wsServer.broadcast("production:update", payload);
    const envelope = await msgPromise;

    expect(envelope.event).toBe("production:update");
    expect(envelope.payload).toMatchObject(payload);
    expect(typeof envelope.timestamp).toBe("string");
    client.close();
  });

  it("broadcasts to all connected clients", async () => {
    const [c1, c2, c3] = await Promise.all([
      connectClient(port),
      connectClient(port),
      connectClient(port),
    ]);

    const messages = Promise.all([nextMessage(c1), nextMessage(c2), nextMessage(c3)]);

    wsServer.broadcast("production:created", {
      productionId: "prod-2",
      farmerId: "farmer-2",
      crop: "maize",
      quantity: 100,
      unit: "kg",
    });

    const results = await messages;
    expect(results).toHaveLength(3);
    results.forEach((msg) => expect(msg.event).toBe("production:created"));
    c1.close(); c2.close(); c3.close();
  });

  it("clientCount reflects connected clients", async () => {
    expect(wsServer.clientCount).toBe(0);
    const c1 = await connectClient(port);
    await sleep(20);
    expect(wsServer.clientCount).toBe(1);
    c1.close();
    await sleep(50);
    expect(wsServer.clientCount).toBe(0);
  });

  it("does not throw when a client is in CLOSING state", async () => {
    const client = await connectClient(port);
    client.close();
    expect(() =>
      wsServer.broadcast("production:deleted", { productionId: "prod-3" })
    ).not.toThrow();
  });

  it("handles non-serialisable payload without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      wsServer.broadcast("production:update", circular as unknown as ProductionUpdatePayload)
    ).not.toThrow();
  });

  it("broadcasts order:status_changed with correct payload", async () => {
    const client = await connectClient(port);
    const msgPromise = nextMessage(client);

    wsServer.broadcast("order:status_changed", {
      orderId: "order-1",
      buyerAddress: "GBUY...",
      sellerAddress: "GSEL...",
      status: "completed",
    });

    const envelope = await msgPromise;
    expect(envelope.event).toBe("order:status_changed");
    expect(envelope.payload).toMatchObject({ orderId: "order-1", status: "completed" });
    client.close();
  });

  it("broadcast with no clients does not throw", () => {
    expect(() =>
      wsServer.broadcast("production:update", {
        productionId: "prod-x",
        farmerId: "f-x",
        status: "pending",
        updatedAt: new Date().toISOString(),
      })
    ).not.toThrow();
  });
});
