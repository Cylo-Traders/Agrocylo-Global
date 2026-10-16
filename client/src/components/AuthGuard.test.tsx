import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import AuthGuard from "./AuthGuard";
import { useWallet } from "@/hooks/useWallet";
import { useProfile } from "@/context/ProfileContext";

describe("AuthGuard hydration handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not redirect while the wallet is still restoring", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      restoring: true,
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
      <AuthGuard>
        <p>Dashboard content</p>
      </AuthGuard>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText(/Checking access/i)).toBeInTheDocument();
  });

  it("renders children for an onboarded, connected farmer without redirecting", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      restoring: false,
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
      <AuthGuard requiredRole="farmer">
        <p>Dashboard content</p>
      </AuthGuard>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });

  it("redirects anonymous users to onboarding once restoration settles", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      restoring: false,
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
      <AuthGuard>
        <p>Dashboard content</p>
      </AuthGuard>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/onboarding");
  });
});
