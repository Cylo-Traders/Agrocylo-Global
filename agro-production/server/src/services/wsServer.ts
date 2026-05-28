/**
 * @file wsServer.ts
 * @description WebSocket broadcast server for agro-production real-time updates.
 *
 * ## Broadcast Contract
 *
 * All messages sent to clients follow this envelope:
 *
 * ```json
 * {
 *   "event": "<event-name>",
 *   "payload": { ... },
 *   "timestamp": "<ISO-8601>"
 * }
 * ```
 *
 * ### Events
 *
 * | Event name             | Trigger                              | Payload fields                                      |
 * |------------------------|--------------------------------------|-----------------------------------------------------|
 * | `production:update`    | A production record is updated       | `{ productionId, farmerId, status, updatedAt }`     |
 * | `production:created`   | A new production record is created   | `{ productionId, farmerId, crop, quantity, unit }`  |
 * | `production:deleted`   | A production record is removed       | `{ productionId }`                                  |
 * | `order:status_changed` | An order status transitions          | `{ orderId, buyerAddress, sellerAddress, status }`  |
 * | `error`                | Server-side broadcast failure        | `{ message }`                                       |
 *
 * ### Broadcast Guarantees
 * - Events are best-effort; no acknowledgement or retry mechanism.
 * - Failed individual client sends are logged and skipped — they do not
 *   affect delivery to other connected clients.
 * - Clients in a non-OPEN ready state are silently skipped.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

export type WsEventName =
  | "production:update"
  | "production:created"
  | "production:deleted"
  | "order:status_changed"
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

const log = {
  info: (msg: string, meta?: unknown) =>
    console.log(JSON.stringify({ level: "info", msg, ...((meta as object) ?? {}) })),
  warn: (msg: string, meta?: unknown) =>
    console.warn(JSON.stringify({ level: "warn", msg, ...((meta as object) ?? {}) })),
  error: (msg: string, meta?: unknown) =>
    console.error(JSON.stringify({ level: "error", msg, ...((meta as object) ?? {}) })),
};

export class WsServer {
  private wss: WebSocketServer;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (socket, req) => {
      const ip = req.socket.remoteAddress ?? "unknown";
      log.info("WebSocket client connected", { ip });

      socket.on("close", () => {
        log.info("WebSocket client disconnected", { ip });
      });

      socket.on("error", (err) => {
        log.error("WebSocket client error", { ip, error: err.message });
      });
    });

    this.wss.on("error", (err) => {
      log.error("WebSocketServer error", { error: err.message });
    });

    log.info("WebSocket server initialised");
  }

  /**
   * Broadcast a typed event to all connected clients.
   *
   * Clients that are not in OPEN state are skipped silently.
   * Send failures for individual clients are logged but do not
   * interrupt delivery to remaining clients.
   *
   * @param event   - The event name (see broadcast contract above).
   * @param payload - The event-specific payload object.
   */
  broadcast<T>(event: WsEventName, payload: T): void {
    const envelope: WsEnvelope<T> = {
      event,
      payload,
      timestamp: new Date().toISOString(),
    };

    let serialised: string;
    try {
      serialised = JSON.stringify(envelope);
    } catch (err) {
      log.error("Failed to serialise WebSocket envelope", {
        event,
        error: (err as Error).message,
      });
      return;
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    this.wss.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) {
        skipped++;
        return;
      }

      client.send(serialised, (err) => {
        if (err) {
          failed++;
          log.error("Failed to send WebSocket message to client", {
            event,
            error: err.message,
          });
        }
      });
      sent++;
    });

    log.info("WebSocket broadcast complete", { event, sent, skipped, failed });
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((err) => {
        if (err) {
          log.error("Error closing WebSocket server", { error: err.message });
          reject(err);
        } else {
          log.info("WebSocket server closed");
          resolve();
        }
      });
    });
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import logger from "../config/logger.js";

let wss: WebSocketServer | null = null;

export function attachWebSocketServer(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    logger.info("WebSocket client connected");

    socket.on("close", () => {
      logger.info("WebSocket client disconnected");
    });

    socket.on("error", (err) => {
      logger.warn("WebSocket socket error", err);
    });
  });

  logger.info("WebSocket server attached at /ws");
}

export function broadcast(event: string, payload: unknown): void {
  if (!wss) return;
  const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
