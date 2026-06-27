import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotificationPreferences, getNotificationPreferences, shouldShowNotification } from "../components/NotificationPreferences";

describe("NotificationPreferences Component", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders all notification preference options", () => {
    render(<NotificationPreferences />);
    
    expect(screen.getByText("Notification Preferences")).toBeInTheDocument();
    expect(screen.getByText("Order Notifications")).toBeInTheDocument();
    expect(screen.getByText("Dispute Notifications")).toBeInTheDocument();
    expect(screen.getByText("System Notifications")).toBeInTheDocument();
  });

  it("loads default preferences when no stored preferences exist", async () => {
    render(<NotificationPreferences />);
    
    await waitFor(() => {
      const orderSwitch = screen.getByRole("switch", { name: /order notifications/i });
      expect(orderSwitch).toHaveAttribute("aria-checked", "true");
    });
  });

  it("toggles order notifications preference", async () => {
    render(<NotificationPreferences />);
    
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /order notifications/i })).toBeInTheDocument();
    });

    const orderSwitch = screen.getByRole("switch", { name: /order notifications/i });
    
    fireEvent.click(orderSwitch);
    
    await waitFor(() => {
      expect(orderSwitch).toHaveAttribute("aria-checked", "false");
    });
    
    const stored = JSON.parse(localStorage.getItem("notification_preferences") || "{}");
    expect(stored.orderNotifications).toBe(false);
  });

  it("toggles dispute notifications preference", async () => {
    render(<NotificationPreferences />);
    
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /dispute notifications/i })).toBeInTheDocument();
    });

    const disputeSwitch = screen.getByRole("switch", { name: /dispute notifications/i });
    
    fireEvent.click(disputeSwitch);
    
    await waitFor(() => {
      expect(disputeSwitch).toHaveAttribute("aria-checked", "false");
    });
  });

  it("toggles system notifications preference", async () => {
    render(<NotificationPreferences />);
    
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /system notifications/i })).toBeInTheDocument();
    });

    const systemSwitch = screen.getByRole("switch", { name: /system notifications/i });
    
    fireEvent.click(systemSwitch);
    
    await waitFor(() => {
      expect(systemSwitch).toHaveAttribute("aria-checked", "false");
    });
  });

  it("shows success message after saving preferences", async () => {
    render(<NotificationPreferences />);
    
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /order notifications/i })).toBeInTheDocument();
    });

    const orderSwitch = screen.getByRole("switch", { name: /order notifications/i });
    fireEvent.click(orderSwitch);
    
    await waitFor(() => {
      expect(screen.getByText("Preferences saved successfully")).toBeInTheDocument();
    });
  });

  it("persists preferences to localStorage", async () => {
    render(<NotificationPreferences />);
    
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /order notifications/i })).toBeInTheDocument();
    });

    const orderSwitch = screen.getByRole("switch", { name: /order notifications/i });
    const disputeSwitch = screen.getByRole("switch", { name: /dispute notifications/i });
    
    fireEvent.click(orderSwitch);
    fireEvent.click(disputeSwitch);
    
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("notification_preferences") || "{}");
      expect(stored.orderNotifications).toBe(false);
      expect(stored.disputeNotifications).toBe(false);
      expect(stored.systemNotifications).toBe(true);
    });
  });

  it("loads saved preferences on mount", async () => {
    localStorage.setItem("notification_preferences", JSON.stringify({
      orderNotifications: false,
      disputeNotifications: true,
      systemNotifications: false,
    }));

    render(<NotificationPreferences />);
    
    await waitFor(() => {
      const orderSwitch = screen.getByRole("switch", { name: /order notifications/i });
      const disputeSwitch = screen.getByRole("switch", { name: /dispute notifications/i });
      const systemSwitch = screen.getByRole("switch", { name: /system notifications/i });
      
      expect(orderSwitch).toHaveAttribute("aria-checked", "false");
      expect(disputeSwitch).toHaveAttribute("aria-checked", "true");
      expect(systemSwitch).toHaveAttribute("aria-checked", "false");
    });
  });
});

describe("Notification Preferences Utilities", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("getNotificationPreferences returns default when no stored preferences", () => {
    const prefs = getNotificationPreferences();
    
    expect(prefs.orderNotifications).toBe(true);
    expect(prefs.disputeNotifications).toBe(true);
    expect(prefs.systemNotifications).toBe(true);
  });

  it("getNotificationPreferences returns stored preferences", () => {
    localStorage.setItem("notification_preferences", JSON.stringify({
      orderNotifications: false,
      disputeNotifications: true,
      systemNotifications: false,
    }));

    const prefs = getNotificationPreferences();
    
    expect(prefs.orderNotifications).toBe(false);
    expect(prefs.disputeNotifications).toBe(true);
    expect(prefs.systemNotifications).toBe(false);
  });

  it("shouldShowNotification respects order notification preference", () => {
    localStorage.setItem("notification_preferences", JSON.stringify({
      orderNotifications: false,
      disputeNotifications: true,
      systemNotifications: true,
    }));

    expect(shouldShowNotification("order")).toBe(false);
    expect(shouldShowNotification("dispute")).toBe(true);
    expect(shouldShowNotification("system")).toBe(true);
  });

  it("shouldShowNotification returns true by default", () => {
    expect(shouldShowNotification("order")).toBe(true);
    expect(shouldShowNotification("dispute")).toBe(true);
    expect(shouldShowNotification("system")).toBe(true);
  });
});
