import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLayout from "./layout";
import { useWallet } from "@/hooks/useWallet";
import { useProfile } from "@/context/ProfileContext";

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

vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/shared/dashboard-footer", () => ({
  DashboardFooter: () => <footer />,
}));

vi.mock("@/components/shared/skip-link", () => ({
  SkipLink: () => null,
}));

vi.mock("./_components/admin-sidebar", () => ({
  AdminSidebar: () => <nav />,
}));

vi.mock("./_components/admin-header", () => ({
  AdminHeader: () => <header />,
}));

vi.mock("./_components/audit-degraded-banner", () => ({
  AuditDegradedBanner: () => null,
}));

describe("AdminLayout - role gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a farmer away from admin pages", () => {
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
      <AdminLayout>
        <p>Admin content</p>
      </AdminLayout>,
    );

    // AuthGuard with requiredRole="admin" redirects non-admin profiles to the
    // single, unguarded mismatch fallback (/market) — see AuthGuard.tsx
    expect(mockReplace).toHaveBeenCalledWith("/market");
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  });

  it("redirects a buyer away from admin pages", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
    } as ReturnType<typeof useWallet>);
    vi.mocked(useProfile).mockReturnValue({
      profile: {
        wallet_address: "GTEST",
        role: "buyer",
        display_name: "Buyer",
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
      <AdminLayout>
        <p>Admin content</p>
      </AdminLayout>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/market");
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  });

  it("renders children for an admin profile", () => {
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
      <AdminLayout>
        <p>Admin content</p>
      </AdminLayout>,
    );

    expect(screen.getByText("Admin content")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
