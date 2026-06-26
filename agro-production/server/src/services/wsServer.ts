import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import logger from "../config/logger.js";

/** Version 1 of the public WebSocket event names. */
export type WsEventName =
  | "production:update"
  | "production:created"
  | "production:deleted"
  | "order:status_changed"
  | "campaign.created"
  | "campaign.invested"
  | "campaign.settled"
  | "investment.indexed"
  | "order.created"
  | "order.confirmed"
  | "error";

export interface WsEnvelope<T = unknown> {
  event: WsEventName;
  payload: T;
  timestamp: string;
}

export interface ProductionUpdatePayload {
  productionId: string;
  farmerId: string;
  status: string;
  updatedAt: string;
}

export interface ProductionCreatedPayload {
  productionId: string;
  farmerId: string;
  crop: string;
  quantity: number;
  unit: string;
}

export interface ProductionDeletedPayload {
  productionId: string;
}

export interface OrderStatusChangedPayload {
  orderId: string;
  buyerAddress: string;
  sellerAddress: string;
  status: string;
}

/**
 * One websocket implementation used both by the standalone test server and
 * the production HTTP server. `path` is optional to preserve the root-path
 * test harness; application traffic is explicitly attached at `/ws`.
 */
export class WsServer {
  private readonly wss: WebSocketServer;

  constructor(server: Server, path?: string) {
    this.wss = new WebSocketServer(path ? { server, path } : { server });

    this.wss.on("connection", (socket, request) => {
      const ip = request.socket.remoteAddress ?? "unknown";
      logger.debug("WebSocket client connected", { ip });
      socket.on("close", () => logger.debug("WebSocket client disconnected", { ip }));
      socket.on("error", (error) => logger.warn("WebSocket client error", { ip, error: error.message }));
    });
    this.wss.on("error", (error) => logger.error("WebSocket server error", { error: error.message }));
  }

  broadcast<T>(event: WsEventName, payload: T): void {
    let message: string;
    try {
      message = JSON.stringify({
        event,
        payload,
        timestamp: new Date().toISOString(),
      } satisfies WsEnvelope<T>);
    } catch (error) {
      logger.warn("Unable to serialize WebSocket message", {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const client of this.wss.clients) {
      // Avoid unbounded buffering behind slow clients. The event is best-effort
      // and clients can always refresh from the indexer-backed REST endpoint.
      if (client.readyState !== WebSocket.OPEN || client.bufferedAmount > 1_000_000) continue;
      client.send(message, (error) => {
        if (error) logger.debug("WebSocket delivery failed", { event, error: error.message });
      });
    }
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
  activeServer = new WsServer(server, "/ws");
  logger.info("WebSocket server attached at /ws");
}

/** Broadcast an indexer event to currently connected clients. */
export function broadcast(event: WsEventName, payload: unknown): void {
  activeServer?.broadcast(event, payload);
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
