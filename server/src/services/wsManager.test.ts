import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "http";
import WebSocket from "ws";
import jwt from "jsonwebtoken";

vi.mock("../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

vi.mock("../config/index.js", () => ({
  config: { wsPath: "/ws", jwtSecret: JWT_SECRET },
}));

import { WsManager } from "./wsManager.js";

describe("WsManager", () => {
  let manager: WsManager;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    manager = new WsManager();
    server = http.createServer();
    manager.init(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function openWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  function closeWs(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.once("close", () => resolve());
      ws.close();
    });
  }

  describe("auth", () => {
    it("keeps connection open after successful authentication", async () => {
      const token = jwt.sign({ walletAddress: "GTEST_VALID" }, JWT_SECRET);
      const ws = await openWs();

      ws.send(JSON.stringify({ type: "auth", token }));
      await new Promise((r) => setTimeout(r, 60));

      expect(ws.readyState).toBe(WebSocket.OPEN);
      await closeWs(ws);
    });

    it("closes with code 4001 on invalid JWT token", async () => {
      const ws = await openWs();

      const code = await new Promise<number>((resolve) => {
        ws.on("close", (c) => resolve(c));
        ws.send(JSON.stringify({ type: "auth", token: "not-a-valid-token" }));
      });

      expect(code).toBe(4001);
    });

    it("closes with code 4001 on non-JSON message", async () => {
      const ws = await openWs();

      const code = await new Promise<number>((resolve) => {
        ws.on("close", (c) => resolve(c));
        ws.send("not-json-at-all");
      });

      expect(code).toBe(4001);
    });

    it("ignores non-auth JSON messages without closing the connection", async () => {
      const ws = await openWs();

      ws.send(JSON.stringify({ type: "ping", data: "heartbeat" }));
      await new Promise((r) => setTimeout(r, 60));

      expect(ws.readyState).toBe(WebSocket.OPEN);
      await closeWs(ws);
    });
  });

  describe("broadcastTo wallet matching", () => {
    it("delivers to the matching wallet regardless of case", async () => {
      const token = jwt.sign({ walletAddress: "GWALLETABC" }, JWT_SECRET);
      const ws = await openWs();
      ws.send(JSON.stringify({ type: "auth", token }));
      await new Promise((r) => setTimeout(r, 60));

      const received: string[] = [];
      ws.on("message", (data) => received.push(data.toString()));

      manager.broadcastTo("gwalletabc", "test:event", { value: 1 });
      await new Promise((r) => setTimeout(r, 60));

      expect(received).toHaveLength(1);
      expect(JSON.parse(received[0]!)).toMatchObject({ event: "test:event" });
      await closeWs(ws);
    });

    it("does not deliver to a non-matching wallet", async () => {
      const token = jwt.sign({ walletAddress: "GWALLET_X" }, JWT_SECRET);
      const ws = await openWs();
      ws.send(JSON.stringify({ type: "auth", token }));
      await new Promise((r) => setTimeout(r, 60));

      const received: string[] = [];
      ws.on("message", (data) => received.push(data.toString()));

      manager.broadcastTo("GWALLET_DIFFERENT", "test:event", {});
      await new Promise((r) => setTimeout(r, 60));

      expect(received).toHaveLength(0);
      await closeWs(ws);
    });
  });

  describe("broadcast", () => {
    it("sends to all connected clients", async () => {
      const ws1 = await openWs();
      const ws2 = await openWs();

      const received1: string[] = [];
      const received2: string[] = [];
      ws1.on("message", (d) => received1.push(d.toString()));
      ws2.on("message", (d) => received2.push(d.toString()));

      manager.broadcast("global:event", { msg: "hello" });
      await new Promise((r) => setTimeout(r, 60));

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      await closeWs(ws1);
      await closeWs(ws2);
    });
  });

  describe("telemetry", () => {
    it("tracks connected client count accurately", async () => {
      const before = manager.clientCount;
      const ws = await openWs();
      await new Promise((r) => setTimeout(r, 30));
      expect(manager.clientCount).toBe(before + 1);
      await closeWs(ws);
      await new Promise((r) => setTimeout(r, 30));
      expect(manager.clientCount).toBe(before);
    });

    it("exposes telemetry with connectedClients and droppedMessages fields", () => {
      const t = manager.telemetry;
      expect(typeof t.connectedClients).toBe("number");
      expect(typeof t.droppedMessages).toBe("number");
      expect(t.droppedMessages).toBeGreaterThanOrEqual(0);
    });
  });
});
