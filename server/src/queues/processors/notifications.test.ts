import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../services/wsManager.js", () => ({
  wsManager: {
    broadcast: vi.fn(),
    broadcastTo: vi.fn(),
    clientCount: 0,
  },
}));
vi.mock("../../services/notificationService.js", () => ({
  NotificationService: {
    notify: vi.fn(),
  },
}));

import { processNotifications } from "./notifications.js";
import { wsManager } from "../../services/wsManager.js";
import { NotificationService } from "../../services/notificationService.js";
import logger from "../../config/logger.js";

function makeJob(name: string, data: unknown, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides.id as string | undefined ?? "job-1",
    name,
    data,
    attemptsMade: (overrides.attemptsMade as number) ?? 0,
    timestamp: 1700000000000,
    opts: {},
    returnvalue: null,
    stacktrace: [],
  } as any;
}

describe("processNotifications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("send-email", () => {
    it("should log email send attempt with valid data", async () => {
      const job = makeJob("send-email", {
        to: "user@example.com",
        subject: "Order Confirmed",
        body: "Your order has been confirmed.",
        html: "<p>Your order has been confirmed.</p>",
      });

      await processNotifications(job);

      expect(logger.info).toHaveBeenCalledWith(
        "Email would be sent",
        expect.objectContaining({
          to: "user@example.com",
          subject: "Order Confirmed",
          hasHtml: true,
        }),
      );
    });

    it("should warn when required fields are missing", async () => {
      const job = makeJob("send-email", {
        subject: "No Recipient",
      });

      await processNotifications(job);

      expect(logger.warn).toHaveBeenCalledWith(
        "Email job missing required fields",
        expect.objectContaining({
          hasTo: false,
          hasSubject: true,
        }),
      );
    });

    it("should warn when subject is missing", async () => {
      const job = makeJob("send-email", {
        to: "user@example.com",
        body: "No subject",
      });

      await processNotifications(job);

      expect(logger.warn).toHaveBeenCalledWith(
        "Email job missing required fields",
        expect.objectContaining({
          hasTo: true,
          hasSubject: false,
        }),
      );
    });

    it("should handle errors and rethrow", async () => {
      const mockError = new Error("Email service unavailable");
      vi.mocked(logger.info).mockImplementationOnce(() => {
        throw mockError;
      });

      const job = makeJob("send-email", {
        to: "user@example.com",
        subject: "Test",
        body: "Test body",
      });

      await expect(processNotifications(job)).rejects.toThrow("Email service unavailable");
      expect(logger.error).toHaveBeenCalledWith(
        "Notification job failed",
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe("send-push", () => {
    it("should deliver push notification via WebSocket", async () => {
      (wsManager as any).clientCount = 3;

      const job = makeJob("send-push", {
        walletAddress: "0xABC123",
        title: "New Order",
        body: "You have a new order #42",
        data: { orderId: "42" },
      });

      await processNotifications(job);

      expect(wsManager.broadcastTo).toHaveBeenCalledWith(
        "0xABC123",
        "notification:push",
        expect.objectContaining({
          title: "New Order",
          body: "You have a new order #42",
          data: { orderId: "42" },
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        "Push notification delivered via WebSocket",
        expect.objectContaining({
          walletAddress: "0xABC123",
          connectedClients: 3,
        }),
      );
    });

    it("should log queued message when no clients connected", async () => {
      (wsManager as any).clientCount = 0;

      const job = makeJob("send-push", {
        walletAddress: "0xDEF456",
        title: "Welcome",
        body: "Welcome to the platform",
      });

      await processNotifications(job);

      expect(logger.info).toHaveBeenCalledWith(
        "Push notification queued (no connected clients)",
        expect.any(Object),
      );
    });

    it("should warn when required fields are missing", async () => {
      const job = makeJob("send-push", {
        title: "Missing Wallet",
      });

      await processNotifications(job);

      expect(logger.warn).toHaveBeenCalledWith(
        "Push notification job missing required fields",
        expect.objectContaining({
          hasWallet: false,
          hasTitle: true,
        }),
      );
    });

    it("should handle WebSocket errors gracefully", async () => {
      (wsManager.broadcastTo as any).mockImplementation(() => {
        throw new Error("WebSocket error");
      });

      const job = makeJob("send-push", {
        walletAddress: "0xERROR",
        title: "Test",
        body: "Should fail",
      });

      await expect(processNotifications(job)).rejects.toThrow("WebSocket error");
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to send push notification",
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe("send-websocket", () => {
    it("should broadcast message to all clients when no wallets specified", async () => {
      const job = makeJob("send-websocket", {
        event: "order:status_changed",
        data: { orderId: "101", status: "confirmed" },
      });

      await processNotifications(job);

      expect(wsManager.broadcast).toHaveBeenCalledWith(
        "order:status_changed",
        { orderId: "101", status: "confirmed" },
      );
      expect(logger.info).toHaveBeenCalledWith(
        "WebSocket message broadcast to all clients",
        expect.objectContaining({ event: "order:status_changed" }),
      );
    });

    it("should broadcast to specific wallets when wallets array provided", async () => {
      const job = makeJob("send-websocket", {
        event: "notification:alert",
        data: { message: "Price alert" },
        wallets: ["0xAAA", "0xBBB"],
      });

      await processNotifications(job);

      expect(wsManager.broadcastTo).toHaveBeenCalledTimes(2);
      expect(wsManager.broadcastTo).toHaveBeenCalledWith(
        "0xAAA",
        "notification:alert",
        { message: "Price alert" },
      );
      expect(wsManager.broadcastTo).toHaveBeenCalledWith(
        "0xBBB",
        "notification:alert",
        { message: "Price alert" },
      );
      expect(logger.info).toHaveBeenCalledWith(
        "WebSocket message sent to specific wallets",
        expect.objectContaining({ walletCount: 2 }),
      );
    });

    it("should warn when event field is missing", async () => {
      const job = makeJob("send-websocket", {
        data: { some: "data" },
      });

      await processNotifications(job);

      expect(logger.warn).toHaveBeenCalledWith(
        "WebSocket job missing required event field",
        expect.any(Object),
      );
      expect(wsManager.broadcast).not.toHaveBeenCalled();
    });

    it("should handle WebSocket errors gracefully", async () => {
      (wsManager.broadcast as any).mockImplementation(() => {
        throw new Error("Broadcast failed");
      });

      const job = makeJob("send-websocket", {
        event: "test:event",
        data: { test: true },
      });

      await expect(processNotifications(job)).rejects.toThrow("Broadcast failed");
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to send WebSocket message",
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe("unknown job name", () => {
    it("should log a warning for unrecognized job names", async () => {
      const job = makeJob("unknown-notification", { some: "data" });

      await processNotifications(job);

      expect(logger.warn).toHaveBeenCalledWith("Unknown notification job name", expect.any(Object));
    });
  });
});
