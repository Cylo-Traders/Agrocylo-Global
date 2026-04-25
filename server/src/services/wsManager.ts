import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "node:http";
import logger from "../config/logger.js";
import { config } from "../config/index.js";

interface AuthMessage {
  type: "auth";
  wallet: string;
}

interface ClientSocket {
  ws: WebSocket;
  wallet: string | null;
}

class WsManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientSocket> = new Map();

  /**
   * Attach a WebSocket server to the existing HTTP server.
   */
  init(server: Server): void {
    this.wss = new WebSocketServer({
      server,
      path: config.wsPath,
    });

    this.wss.on("connection", (ws: WebSocket) => {
      const client: ClientSocket = { ws, wallet: null };
      this.clients.set(ws, client);
      logger.info(`WebSocket client connected (total: ${this.clients.size})`);

      ws.on("message", (raw: RawData) => {
        try {
          const msg = JSON.parse(raw.toString()) as AuthMessage;
          if (msg.type === "auth" && msg.wallet) {
            client.wallet = msg.wallet;
            logger.info(`WebSocket client authenticated: ${msg.wallet}`);
          }
        } catch {
          logger.warn("WebSocket received non-JSON message, ignoring");
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        logger.info(
          `WebSocket client disconnected (total: ${this.clients.size})`,
        );
      });

      ws.on("error", (err: Error) => {
        logger.error("WebSocket client error", err);
        this.clients.delete(ws);
      });
    });

    logger.info(
      `WebSocket server listening on path ${config.wsPath}`,
    );
  }

  /**
   * Broadcast an event to every connected client.
   */
  broadcast(event: string, payload: unknown): void {
    const message = JSON.stringify({
      event,
      payload,
      timestamp: new Date().toISOString(),
    });

    for (const { ws } of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  /**
   * Broadcast an event only to clients authenticated with the given wallet address.
   */
  broadcastTo(wallet: string, event: string, payload: unknown): void {
    const message = JSON.stringify({
      event,
      payload,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.clients.values()) {
      if (
        client.wallet?.toLowerCase() === wallet.toLowerCase() &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        client.ws.send(message);
      }
    }
  }

  /**
   * Number of currently connected clients.
   */
  get clientCount(): number {
    return this.clients.size;
  }
}

export const wsManager = new WsManager();
