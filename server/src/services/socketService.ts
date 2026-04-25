import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import logger from "../config/logger.js";

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

    this.instance.on("connection", (socket) => {
      logger.info(`[SocketService]: Client connected: ${socket.id}`);

      socket.on("disconnect", () => {
        logger.info(`[SocketService]: Client disconnected: ${socket.id}`);
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

  public static emit(event: string, data: any) {
    if (this.instance) {
      this.instance.emit(event, data);
      logger.info(`[SocketService]: Emitted event '${event}' with data:`, data);
    } else {
      logger.warn(`[SocketService]: Cannot emit event '${event}', Socket.io not initialized.`);
    }
  }
}
