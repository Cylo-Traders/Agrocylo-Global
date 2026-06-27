import { createServer } from "http";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachWebSocketServer, broadcast, closeWebSocketServer } from "../wsServer.js";

function connectClient(port: number, path?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${path ?? '/ws'}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<{ version: string; type: string; payload: unknown; timestamp: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No message received within 2s')), 2000);
    ws.once("message", (data) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
  });
}

describe("WebSocket server (functional)", () => {
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    attachWebSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, () => {
      const addr = httpServer.address() as { port: number };
      port = addr.port;
      resolve();
    }));
  });

  afterEach(async () => {
    await closeWebSocketServer();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("broadcasts correct envelope shape to connected client", async () => {
    const client = await connectClient(port);
    const msgPromise = nextMessage(client);

    broadcast("campaign.created", { id: "1", farmerAddress: "G...", tokenAddress: "G..." });

    const envelope = await msgPromise;
    expect(envelope.version).toBe("1");
    expect(envelope.type).toBe("campaign.created");
    expect(envelope.payload).toMatchObject({ id: "1" });
    expect(typeof envelope.timestamp).toBe("string");
    client.close();
  });

  it("broadcasts to all connected clients", async () => {
    const [c1, c2] = await Promise.all([
      connectClient(port),
      connectClient(port),
    ]);

    const msg1 = nextMessage(c1);
    const msg2 = nextMessage(c2);

    broadcast("campaign.invested", {
      campaignId: "1",
      investorAddress: "G...",
      amount: "100",
      totalRaised: "200",
    });

    const results = await Promise.all([msg1, msg2]);
    expect(results).toHaveLength(2);
    results.forEach((msg) => expect(msg.type).toBe("campaign.invested"));
    c1.close();
    c2.close();
  });

  it("broadcast does not throw when no clients connected", () => {
    expect(() =>
      broadcast("campaign.invested", { campaignId: "1", investorAddress: "G...", amount: "100", totalRaised: "200" })
    ).not.toThrow();
  });

  it("closeWebSocketServer resolves", async () => {
    await closeWebSocketServer();
    // Should not throw
  });
});
