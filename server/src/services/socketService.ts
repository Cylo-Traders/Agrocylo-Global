import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import logger from "../config/logger.js";

const MAX_CONNECTIONS = 1_000;

export class SocketService {
  private static instance: SocketIOServer | null = null;

  public static initialize(httpServer: HTTPServer): SocketIOServer {
    if (this.instance) {
      return this.instance;
    }

    this.instance = new SocketIOServer(httpServer, {
      cors: {
        origin: "*", // Adjust in production
        methods: ["GET", "POST"],
      },
    });

    this.instance.on("error", (err: Error) => {
      logger.error("[SocketService]: Server error", err);
    });

    this.instance.on("connection", (socket) => {
      if (this.instance!.sockets.sockets.size > MAX_CONNECTIONS) {
        logger.warn("[SocketService]: Connection limit reached, disconnecting client");
        socket.disconnect(true);
        return;
      }

      logger.info(`[SocketService]: Client connected: ${socket.id}`);

      socket.on("error", (err: Error) => {
        logger.error(`[SocketService]: Socket error: ${socket.id}`, err);
      });

      socket.on("disconnect", (reason: string) => {
        logger.info(`[SocketService]: Client disconnected: ${socket.id}`, { reason });
      });
    });

    logger.info("[SocketService]: Initialized Socket.io");
    return this.instance;
  }

  public static getInstance(): SocketIOServer {
    if (!this.instance) {
      throw new Error("SocketService must be initialized with an HTTP server first.");
    }
    return this.instance;
  }

  public static emit(event: string, data: unknown) {
    if (this.instance) {
      this.instance.emit(event, data);
      logger.info(`[SocketService]: Emitted event '${event}' with data:`, data);
    } else {
      logger.warn(`[SocketService]: Cannot emit event '${event}', Socket.io not initialized.`);
    }
  }
}
