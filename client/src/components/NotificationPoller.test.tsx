import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import NotificationPoller from "./NotificationPoller";

const mockPush = vi.fn();
const mockListUnreadNotifications = vi.fn();
const mockMarkNotificationsRead = vi.fn();
const mockShowOrderEventToast = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    connected: true,
  }),
}));

vi.mock("@/services/notification/api", () => ({
  listUnreadNotifications: (...args: unknown[]) => mockListUnreadNotifications(...args),
  markNotificationsRead: (...args: unknown[]) => mockMarkNotificationsRead(...args),
}));

vi.mock("@/services/notification", () => ({
  showOrderEventToast: (...args: unknown[]) => mockShowOrderEventToast(...args),
}));

describe("NotificationPoller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("polls unread notifications, shows a toast, and wires navigation to the order page", async () => {
    mockListUnreadNotifications.mockResolvedValue([
      {
        id: "n1",
        walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        message: "Order funded: order #42 has been locked in escrow.",
        orderId: "42",
        type: "created",
        isRead: false,
        createdAt: "2026-04-24T12:00:00.000Z",
      },
    ]);
    mockMarkNotificationsRead.mockResolvedValue({ count: 1 });

    render(<NotificationPoller />);

    await waitFor(() => {
      expect(mockListUnreadNotifications).toHaveBeenCalledWith(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      );
    });

    expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1);
    expect(mockMarkNotificationsRead).toHaveBeenCalledWith(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      ["n1"],
    );

    const openOrder = mockShowOrderEventToast.mock.calls[0]?.[1];
    expect(typeof openOrder).toBe("function");

    openOrder("42");
    expect(mockPush).toHaveBeenCalledWith("/orders/42");
  });
});
