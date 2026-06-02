import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AdminGuard from "./AdminGuard";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: vi.fn(),
}));

vi.mock("@/context/ProfileContext", () => ({
  useProfile: vi.fn(),
}));

import { useWallet } from "@/hooks/useWallet";
import { useProfile } from "@/context/ProfileContext";

describe("AdminGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children for admin users", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
    } as ReturnType<typeof useWallet>);
    vi.mocked(useProfile).mockReturnValue({
      profile: {
        wallet_address: "GTEST",
        role: "admin",
        display_name: "Admin",
        bio: null,
        avatar_url: null,
      },
      isLoaded: true,
      isOnboarded: true,
      isAdmin: true,
      error: null,
      refresh: vi.fn(),
      setProfile: vi.fn(),
    });

    render(
      <AdminGuard>
        <p>Admin content</p>
      </AdminGuard>,
    );

    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });

  it("shows access denied for non-admin users", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
    } as ReturnType<typeof useWallet>);
    vi.mocked(useProfile).mockReturnValue({
      profile: {
        wallet_address: "GTEST",
        role: "farmer",
        display_name: "Farmer",
        bio: null,
        avatar_url: null,
      },
      isLoaded: true,
      isOnboarded: true,
      isAdmin: false,
      error: null,
      refresh: vi.fn(),
      setProfile: vi.fn(),
    });

    render(
      <AdminGuard>
        <p>Admin content</p>
      </AdminGuard>,
    );

    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  });

  it("redirects unauthenticated users to onboarding", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
    } as ReturnType<typeof useWallet>);
    vi.mocked(useProfile).mockReturnValue({
      profile: null,
      isLoaded: true,
      isOnboarded: false,
      isAdmin: false,
      error: null,
      refresh: vi.fn(),
      setProfile: vi.fn(),
    });

    render(
      <AdminGuard>
        <p>Admin content</p>
      </AdminGuard>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/onboarding");
  });
});
