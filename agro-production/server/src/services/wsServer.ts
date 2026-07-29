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
  | "investment.indexed"
  | "order.created"
  | "order.confirmed"
  | "dispute.opened"
  | "dispute.evidence_submitted"
  | "dispute.resolved"
  | "dispute.dismissed"
  | "transaction.status"
  | "message:new"
  | "message:edited"
  | "message:deleted"
  | "message:read"
  | "error";

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
 * Supports wallet-scoped message delivery for 1:1 messaging.
 */
export class WsServer {
  private readonly wss: WebSocketServer;
  private readonly maxQueueDepth = 100;
  private readonly clientQueues = new WeakMap<WebSocket, string[]>();
  private readonly walletConnections = new Map<string, Set<WebSocket>>();
  private readonly MAX_CONNECTIONS = 1000;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30s

  constructor(server: Server, path: string = "/ws") {
    this.wss = new WebSocketServer({ server, path });

    this.wss.on("connection", (socket: WebSocket, request) => {
      const ip = (request.socket.remoteAddress as string | undefined) ?? "unknown";
      logger.debug("WebSocket client connected", { ip, clients: this.wss.clients.size });
      this.clientQueues.set(socket, []);

      // Initialize heartbeat
      let isAlive = true;
      socket.on("pong", () => {
        isAlive = true;
      });

      socket.on("close", () => {
        logger.debug("WebSocket client disconnected", { ip, clients: this.wss.clients.size });
        // Clean up wallet mapping on disconnect
        for (const clients of this.walletConnections.values()) {
          clients.delete(socket);
        }
      });

      socket.on("error", (error: Error) => {
        logger.warn("WebSocket client error", { ip, error: error.message });
      });

      // Handle wallet authentication message
      socket.on("message", (data: RawData) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "auth" && message.walletAddress) {
            const walletAddress = message.walletAddress;
            if (!this.walletConnections.has(walletAddress)) {
              this.walletConnections.set(walletAddress, new Set());
            }
            this.walletConnections.get(walletAddress)!.add(socket);
            logger.debug("WebSocket client authenticated", { walletAddress, clientId: ip });
          }
        } catch {
          // Ignore non-JSON messages
        }
      });
    });

    this.wss.on("error", (error: Error) => {
      logger.error("WebSocket server error", { error: error.message });
    });

    // Start heartbeat interval
    const heartbeat = setInterval(() => {
      if (this.wss.clients.size > this.MAX_CONNECTIONS) {
        logger.warn("WebSocket connection limit exceeded", {
          clients: this.wss.clients.size,
          limit: this.MAX_CONNECTIONS,
        });
      }

      for (const socket of this.wss.clients) {
        const typedSocket = socket as any;
        if (typedSocket.isAlive === false) {
          socket.terminate();
          continue;
        }
        typedSocket.isAlive = false;
        socket.ping();
      }
    }, this.HEARTBEAT_INTERVAL);

    // Cleanup interval on close
    this.wss.on("close", () => {
      clearInterval(heartbeat);
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

  /**
   * Send a message to a specific wallet address (1:1 delivery).
   * Used for private notifications like new chat messages.
   */
  broadcastTo<T>(walletAddress: string, type: WsEventType, payload: T): void {
    const clients = this.walletConnections.get(walletAddress);
    if (!clients || clients.size === 0) {
      logger.debug("No connected clients for wallet", { walletAddress, type });
      return;
    }

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
        walletAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;

      const queue = this.clientQueues.get(client);
      if (queue) {
        if (queue.length >= this.maxQueueDepth) {
          queue.shift();
          logger.warn("WebSocket send queue exceeded, dropping oldest message", {
            walletAddress,
            queueDepth: this.maxQueueDepth,
          });
        }
        queue.push(message);
      }

      this.flushQueue(client, type);
    }
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

export function broadcastTo<T>(
  walletAddress: string,
  type: WsEventType,
  payload: T,
): void {
  activeServer?.broadcastTo(walletAddress, type, payload);
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
