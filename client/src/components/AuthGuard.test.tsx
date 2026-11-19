import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

describe("AuthGuard role gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockAuthState({
    role,
    connected = true,
  }: {
    role: "farmer" | "buyer" | "moderator" | "admin" | null;
    connected?: boolean;
  }) {
    vi.mocked(useWallet).mockReturnValue({
      connected,
      restoring: false,
    } as ReturnType<typeof useWallet>);
    vi.mocked(useProfile).mockReturnValue({
      profile: role
        ? {
            wallet_address: "GTEST",
            role,
            display_name: "User",
            bio: null,
            avatar_url: null,
          }
        : null,
      isLoaded: true,
      isOnboarded: role !== null,
      isAdmin: role === "admin",
      error: null,
      refresh: vi.fn(),
      setProfile: vi.fn(),
    });
  }

  it("renders children when the profile role matches requiredRole", () => {
    mockAuthState({ role: "farmer" });

    render(
      <AuthGuard requiredRole="farmer">
        <p>Dashboard content</p>
      </AuthGuard>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });

  it("redirects unauthenticated users to onboarding and renders the loader", () => {
    mockAuthState({ role: null, connected: false });

    render(
      <AuthGuard requiredRole="farmer">
        <p>Dashboard content</p>
      </AuthGuard>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/onboarding");
    expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
  });

  it("redirects a wrong-role user to the single fallback destination", () => {
    mockAuthState({ role: "buyer" });

    render(
      <AuthGuard requiredRole="farmer">
        <p>Dashboard content</p>
      </AuthGuard>,
    );

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/market");
    expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
  });

  it("uses the same fallback for non-farmer roles mismatching an admin route", () => {
    mockAuthState({ role: "farmer" });

    render(
      <AuthGuard requiredRole="admin">
        <p>Admin content</p>
      </AuthGuard>,
    );

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/market");
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  });
});

describe("AuthGuard redirect targets are never guarded (no redirect loops)", () => {
  const appRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../app",
  );

  function collectTsxFiles(dir: string): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return collectTsxFiles(fullPath);
        return fullPath.endsWith(".tsx") ? [fullPath] : [];
      });
  }

  // Wrong-role users land on /market and unauthenticated users on /onboarding;
  // neither route may render AuthGuard, otherwise the guard would redirect
  // back into itself.
  const fallbackRoutes = [
    { name: "/market", dir: path.join(appRoot, "(root)/market") },
    { name: "/onboarding", dir: path.join(appRoot, "(root)/onboarding") },
  ];

  for (const { name, dir } of fallbackRoutes) {
    it(`${name} does not use AuthGuard`, () => {
      const files = collectTsxFiles(dir);
      expect(files.length).toBeGreaterThan(0);

      const guarded = files.filter((file) =>
        /import AuthGuard|<AuthGuard\b/.test(fs.readFileSync(file, "utf8")),
      );
      expect(guarded).toEqual([]);
    });
  }
});
