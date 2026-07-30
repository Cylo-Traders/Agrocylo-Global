import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { RawData } from "ws";
import jwt from "jsonwebtoken";
import logger from "../config/logger.js";
import { config } from "../config/index.js";

/**
 * Versioned WebSocket event types. All emitted events conform to WsEventEnvelope,
 * which uses a discriminated union to ensure type safety on the client.
 */
export type WsEventType =
  | "campaign.created"
  | "campaign.invested"
  | "campaign.settled"
  | "investment.indexed"
  | "order.created"
  | "order.confirmed"
  | "dispute.opened"
  | "dispute.evidence_submitted"
  | "dispute.resolved"
  | "dispute.dismissed"
  | "transaction.status"
  | "message.received"
  | "message.deleted"
  | "conversation.blocked"
  | "error";

export interface WsEventEnvelope<T = unknown> {
  version: "1";
  type: WsEventType;
  payload: T;
  timestamp: string;
}

interface AuthMessage {
  type: "auth";
  token: string;
}

interface ClientSocket {
  ws: WebSocket;
  walletAddress: string | null;
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
  private readonly clientMetadata = new WeakMap<WebSocket, ClientSocket>();

  constructor(server: Server, path: string = "/ws") {
    this.wss = new WebSocketServer({ server, path });

    this.wss.on("connection", (socket: WebSocket, request) => {
      const ip = (request.socket.remoteAddress as string | undefined) ?? "unknown";
      logger.debug("WebSocket client connected", { ip, clients: this.wss.clients.size });

      const client: ClientSocket = { ws: socket, walletAddress: null };
      this.clientMetadata.set(socket, client);
      this.clientQueues.set(socket, []);

      socket.on("message", (data: RawData) => {
        this.handleClientMessage(socket, data);
      });

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

  private handleClientMessage(socket: WebSocket, data: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      logger.warn("WebSocket received non-JSON message; closing connection");
      socket.close(4001, "Bad Request");
      return;
    }

    const msg = parsed as AuthMessage;
    if (msg.type !== "auth" || !msg.token) return;

    const client = this.clientMetadata.get(socket);
    if (!client) return;

    try {
      const payload = jwt.verify(msg.token, config.jwtSecret) as { walletAddress: string };
      client.walletAddress = payload.walletAddress;
      logger.debug(`WebSocket client authenticated: ${client.walletAddress}`);
    } catch (error) {
      logger.warn("WebSocket auth token invalid; closing connection", {
        error: error instanceof Error ? error.message : String(error),
      });
      socket.close(4001, "Unauthorized");
    }
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

  sendTo<T>(walletAddress: string, type: WsEventType, payload: T): void {
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
      const metadata = this.clientMetadata.get(client);
      if (!metadata || client.readyState !== WebSocket.OPEN) continue;

      if (metadata.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
        continue;
      }

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

  drain(): Promise<void> {
    return new Promise((resolve) => {
      const clients = Array.from(this.wss.clients);
      if (clients.length === 0) {
        resolve();
        return;
      }

      let remaining = clients.length;
      const timeout = setTimeout(() => {
        logger.warn('WebSocket drain timed out, terminating remaining connections');
        for (const c of clients) {
          if (c.readyState === c.OPEN) {
            c.terminate();
          }
        }
        resolve();
      }, 5000);

      for (const client of clients) {
        try {
          const msg = JSON.stringify({
            version: '1',
            type: 'server.shutdown',
            payload: { reason: 'graceful_shutdown' },
            timestamp: new Date().toISOString(),
          });
          client.send(msg, () => {
            client.close(1001, 'Server shutting down');
            remaining--;
            if (remaining <= 0) {
              clearTimeout(timeout);
              resolve();
            }
          });
        } catch {
          client.terminate();
          remaining--;
          if (remaining <= 0) {
            clearTimeout(timeout);
            resolve();
          }
        }
      }
    });
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
  activeServer = new WsServer(server, "/ws");
  logger.info("WebSocket server attached at /ws");
}

export function broadcast(type: WsEventType, payload: unknown): void {
  activeServer?.broadcast(type, payload);
}

export function sendTo(walletAddress: string, type: WsEventType, payload: unknown): void {
  activeServer?.sendTo(walletAddress, type, payload);
}

export function getWsClientCount(): number {
  return activeServer?.clientCount ?? 0;
}

export function closeWebSocketServer(): Promise<void> {
  if (!activeServer) return Promise.resolve();
  return activeServer.close().then(() => {
    activeServer = null;
    logger.info("WebSocket server closed");
  });
}

export function drainWebSocketServer(): Promise<void> {
  const server = activeServer;
  if (!server) return Promise.resolve();
  return server.drain();
}
