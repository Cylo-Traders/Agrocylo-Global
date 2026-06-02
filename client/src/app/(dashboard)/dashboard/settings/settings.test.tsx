import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SettingsPage from "./page";

const mockProfile = {
  wallet_address: "GTEST",
  role: "farmer" as const,
  display_name: "Old Name",
  bio: "Old bio",
  avatar_url: null,
};

const mockUpdateProfile = vi.fn();
const mockSetProfile = vi.fn();

vi.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({
    profile: mockProfile,
    setProfile: mockSetProfile,
    isLoaded: true,
    isOnboarded: true,
    isAdmin: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "GTEST",
    connected: true,
  }),
}));

vi.mock("@/services/profileService", () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

vi.mock("@/components/NotificationPreferences", () => ({
  NotificationPreferences: () => <div data-testid="notification-prefs" />,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile.display_name = "Old Name";
    mockProfile.bio = "Old bio";
    mockUpdateProfile.mockResolvedValue({
      wallet_address: "GTEST",
      role: "farmer",
      display_name: "New Name",
      bio: "New bio",
      avatar_url: null,
    });
  });

  it("enables save only when profile fields are valid and changed", async () => {
    render(<SettingsPage />);
    const saveButton = screen.getByRole("button", { name: /Save changes/i });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: "New Name" },
    });

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
  });

  it("shows inline error when profile update fails", async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error("Profile not found"));

    render(<SettingsPage />);
    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: "New Name" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Save changes/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/Profile not found/i)).toBeInTheDocument();
    });
  });

  it("saves profile successfully", async () => {
    render(<SettingsPage />);
    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: "New Name" },
    });
    fireEvent.change(screen.getByLabelText(/^Bio$/i), {
      target: { value: "New bio" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Save changes/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith("GTEST", {
        display_name: "New Name",
        bio: "New bio",
      });
      expect(mockSetProfile).toHaveBeenCalled();
    });
  });
});
