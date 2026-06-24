import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { RawData } from "ws";
import logger from "../config/logger.js";

/**
 * Versioned WebSocket event types. All emitted events conform to WsEventEnvelope,
 * which uses a discriminated union to ensure type safety on the client.
 */
export type WsEventType =
  | "campaign.created"
  | "campaign.invested"
  | "campaign.settled"
  | "order.created"
  | "order.confirmed";

export interface WsEventEnvelope<T = unknown> {
  version: "1";
  type: WsEventType;
  payload: T;
  timestamp: string;
}

/**
 * One websocket implementation used by the production HTTP server.
 * Manages client connections, broadcasts events with serialization safety,
 * and enforces backpressure to prevent unbounded buffering.
 */
export class WsServer {
  private readonly wss: WebSocketServer;
  private readonly maxQueueDepth = 100;
  private readonly clientQueues = new WeakMap<WebSocket, string[]>();

  constructor(server: Server, path: string = "/ws") {
    this.wss = new WebSocketServer({ server, path });

    this.wss.on("connection", (socket: WebSocket, request) => {
      const ip = (request.socket.remoteAddress as string | undefined) ?? "unknown";
      logger.debug("WebSocket client connected", { ip, clients: this.wss.clients.size });
      this.clientQueues.set(socket, []);

      socket.on("close", () => {
        logger.debug("WebSocket client disconnected", { ip, clients: this.wss.clients.size });
      });

      socket.on("error", (error: Error) => {
        logger.warn("WebSocket client error", { ip, error: error.message });
      });
    });

    this.wss.on("error", (error: Error) => {
      logger.error("WebSocket server error", { error: error.message });
    });
  }

  broadcast<T>(type: WsEventType, payload: T): void {
    let message: string;
    try {
      message = JSON.stringify({
        version: "1",
        type,
        payload,
        timestamp: new Date().toISOString(),
      } satisfies WsEventEnvelope<T>);
    } catch (error) {
      logger.warn("Unable to serialize WebSocket message", {
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;

      const queue = this.clientQueues.get(client);
      if (queue) {
        if (queue.length >= this.maxQueueDepth) {
          queue.shift();
          logger.warn("WebSocket send queue exceeded, dropping oldest message", {
            clientCount: this.wss.clients.size,
            queueDepth: this.maxQueueDepth,
          });
        }
        queue.push(message);
      }

      this.flushQueue(client, type);
    }
  }

  private flushQueue(client: WebSocket, type: WsEventType): void {
    const queue = this.clientQueues.get(client);
    if (!queue || queue.length === 0) return;

    const message = queue[0];
    client.send(message, (error: Error | undefined) => {
      if (error) {
        logger.debug("WebSocket delivery failed", { type, error: error.message });
      } else {
        queue.shift();
        if (queue.length > 0) {
          process.nextTick(() => this.flushQueue(client, type));
        }
      }
    });
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

let activeServer: WsServer | null = null;

export function attachWebSocketServer(server: Server): void {
  if (activeServer) {
    throw new Error("WebSocket server is already attached");
  }
  activeServer = new WsServer(server);
  logger.info("WebSocket server attached at /ws");
}

export function broadcast(type: WsEventType, payload: unknown): void {
  activeServer?.broadcast(type, payload);
}

export async function closeWebSocketServer(): Promise<void> {
  if (!activeServer) {
    return;
  }
  await activeServer.close();
  activeServer = null;
  logger.info("WebSocket server closed");
}

export function getWebSocketServer(): WsServer | null {
  return activeServer;
}
