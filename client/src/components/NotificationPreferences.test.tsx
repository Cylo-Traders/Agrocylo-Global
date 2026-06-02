import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationPreferences } from "./NotificationPreferences";

const mockGetPrefs = vi.fn();
const mockUpdatePrefs = vi.fn();

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    connected: true,
  }),
}));

vi.mock("@/services/notification/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/notification/api")>();
  return {
    ...actual,
    getNotificationPreferences: (...args: unknown[]) => mockGetPrefs(...args),
    updateNotificationPreferences: (...args: unknown[]) => mockUpdatePrefs(...args),
  };
});

describe("NotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetPrefs.mockResolvedValue({
      types: {
        orders: true,
        disputes: true,
        priceAlerts: true,
        system: true,
        demandSignals: false,
      },
      delivery: { toast: true, email: false, push: false },
      sound: true,
      quietHoursEnabled: false,
      quietStart: "22:00",
      quietEnd: "08:00",
    });
    mockUpdatePrefs.mockImplementation(async (_wallet, prefs) => prefs);
  });

  it("loads preferences from the API on mount", async () => {
    render(<NotificationPreferences embedded />);
    await waitFor(() => {
      expect(mockGetPrefs).toHaveBeenCalled();
    });
    expect(screen.getByLabelText(/Order updates/i)).toBeInTheDocument();
  });

  it("rolls back when save fails", async () => {
    mockUpdatePrefs.mockRejectedValueOnce(new Error("Server unavailable"));

    render(<NotificationPreferences embedded />);
    await waitFor(() => expect(mockGetPrefs).toHaveBeenCalled());

    const toggle = screen.getByRole("switch", { name: /Demand signals/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText(/Server unavailable/i)).toBeInTheDocument();
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
