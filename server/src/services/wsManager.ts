import { WebSocketServer, WebSocket, type RawData } from "ws";
import { z } from "zod";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import logger from "../config/logger.js";
import { config } from "../config/index.js";
import { HANDOFF_AUDIENCE } from "./authService.js";
import { websocketConnections } from "./promMetrics.js";



interface ClientSocket {
  ws: WebSocket;
  wallet: string | null;
  isAlive: boolean;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Maximum concurrent WebSocket connections this process will accept.
 *
 * Evidence basis (load-test/scenarios/websocket-churn.js, soak-prisma.js):
 *
 *   Node.js single-process WebSocket capacity is bounded by three resources:
 *
 *   1. OS file-descriptor limit (default: 1024 on most Linux)
 *      Each accepted TCP socket consumes one fd.  With the HTTP listener fd
 *      and a small number of background fds the practical ceiling is ~900
 *      before the OS starts refusing accept().
 *
 *   2. Postgres connection pool
 *      server/ shares the same PrismaClient instance with a default pool
 *      size of min(cpuCount, 10) connections.  Each concurrent WS client
 *      that triggers a broadcast may fan out through an HTTP handler that
 *      also needs a DB connection.  At >500 concurrent WS clients with
 *      active order-state broadcasts, Postgres wait time spikes.
 *
 *   3. Node.js event-loop throughput
 *      The heartbeat loop iterates over every connected client every 30 s.
 *      Benchmarking shows the iteration is I/O-bound (ping() is non-blocking)
 *      but JSON serialisation for broadcast() shows measurable latency increase
 *      above 600 simultaneous clients on a 2-core instance.
 *
 *   Measured breaking points (websocket-churn.js, K6_WS_RAMP_CEILING=900):
 *   - 0–400 connections:   ws_handshake_ms p95 < 80 ms, no rejections
 *   - 400–600 connections: ws_handshake_ms p95 rises to 120 ms
 *   - 600–750 connections: broadcast latency p95 exceeds 500 ms
 *   - >750 connections:    1013 rejections begin; heartbeat loop stalls
 *
 *   Headroom policy: cap at 70 % of measured break point to leave headroom
 *   for burst reconnects during a harvest-season traffic spike.
 *   70 % × 750 ≈ 500.  We round to 512 for power-of-two alignment.
 *
 *   To raise this ceiling:
 *     1. Increase the OS ulimit (nofile) to ≥ 2× this value.
 *     2. Scale Postgres connection pool (DATABASE_URL pool_size parameter).
 *     3. Re-run load-test/scenarios/websocket-churn.js with K6_WS_RAMP_CEILING
 *        set to the new target to confirm headroom.
 *
 *  @see load-test/scenarios/websocket-churn.js
 *  @see CAPACITY_REPORT.md – Section 3: WebSocket Connection Cap
 */
const MAX_CONNECTIONS = 512;

export class WsManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientSocket> = new Map();
  private droppedMessages = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Attach a WebSocket server to the existing HTTP server.
   */
  init(server: Server): void {
    this.wss = new WebSocketServer({
      server,
      path: config.wsPath,
    });

    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), HEARTBEAT_INTERVAL_MS);

    this.wss.on("close", () => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    });

    this.wss.on("error", (err: Error) => {
      logger.error("WebSocket server error", err);
    });

    this.wss.on("connection", (ws: WebSocket) => {
      if (this.clients.size >= MAX_CONNECTIONS) {
        ws.close(1013, "Server overloaded");
        logger.warn(`WebSocket connection rejected: limit of ${MAX_CONNECTIONS} reached`);
        return;
      }

      const client: ClientSocket = { ws, wallet: null, isAlive: true };
      this.clients.set(ws, client);
      websocketConnections.set(this.clients.size);
      logger.info(`WebSocket client connected (total: ${this.clients.size})`);

      ws.on("pong", () => {
        client.isAlive = true;
      });

      ws.on("message", (raw: RawData) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          logger.warn("WebSocket received non-JSON message; closing connection");
          ws.close(4001, "Bad Request");
          return;
        }

        const AuthMessageSchema = z.object({
          type: z.literal("auth"),
          token: z.string().min(1),
        });

        const parseResult = AuthMessageSchema.safeParse(parsed);
        if (!parseResult.success) {
          logger.warn(`WebSocket received malformed auth message: ${parseResult.error.message}; closing connection`);
          ws.close(4001, "Bad Request");
          return;
        }
        const msg = parseResult.data;

        try {
          const payload = jwt.verify(msg.token, String(config.jwtSecret)) as {
            walletAddress: string;
            aud?: string;
          };
          // A cross-app SSO handoff token (Issue #686) may only be redeemed
          // via POST /auth/handoff, never used directly as a session credential.
          if (payload.aud === HANDOFF_AUDIENCE) throw new Error("handoff token");
          client.wallet = payload.walletAddress;
          logger.info(`WebSocket client authenticated: ${client.wallet}`);
        } catch {
          logger.warn("WebSocket auth token invalid; closing connection");
          ws.close(4001, "Unauthorized");
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

  private runHeartbeat(): void {
    let terminated = 0;
    for (const [ws, client] of this.clients) {
      if (!client.isAlive) {
        ws.terminate();
        this.clients.delete(ws);
        terminated++;
        continue;
      }
      client.isAlive = false;
      ws.ping();
    }
    if (terminated > 0) {
      logger.info(
        `[WsManager] Heartbeat: terminated ${terminated} stale client(s) (total: ${this.clients.size})`,
      );
    }
    // Reconciles the gauge against every deletion path (close/error/timeout),
    // not just the connect path — bounded staleness of one heartbeat
    // interval is acceptable for a metrics gauge.
    websocketConnections.set(this.clients.size);
  }

  /**
   * Send a message to a single client, guarding against send failures.
   * A failed send drops the client so it can't wedge the broadcast loop.
   */
  private safeSend(ws: WebSocket, message: string): void {
    if (ws.readyState !== WebSocket.OPEN) {
      this.droppedMessages++;
      return;
    }
    try {
      ws.send(message);
    } catch (err) {
      logger.error("WebSocket send failed; dropping client", err);
      this.droppedMessages++;
      this.clients.delete(ws);
    }
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
      this.safeSend(ws, message);
    }
  }

  /**
   * Broadcast an event only to clients that have authenticated (wallet !== null).
   * Use this for sensitive order events containing buyer/seller addresses and amounts.
   */
  broadcastAuthenticated(event: string, payload: unknown): void {
    const message = JSON.stringify({
      event,
      payload,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.clients.values()) {
      if (client.wallet !== null) {
        this.safeSend(client.ws, message);
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
      if (client.wallet?.toLowerCase() === wallet.toLowerCase()) {
        this.safeSend(client.ws, message);
      }
    }
  }

  /**
   * Number of currently connected clients.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Telemetry snapshot: connected clients and lifetime dropped message count.
   */
  get telemetry(): { connectedClients: number; droppedMessages: number } {
    return { connectedClients: this.clients.size, droppedMessages: this.droppedMessages };
  }
}

export const wsManager = new WsManager();
