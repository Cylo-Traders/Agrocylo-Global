import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Profile } from "@/services/profileService";

vi.mock("next/image", () => ({
  default: () => null,
}));

vi.mock("@/context/CartContext", () => ({
  useCart: () => ({ itemCount: 0, setDrawerOpen: vi.fn() }),
}));

vi.mock("@/components/shared/connect-wallet", () => ({
  default: () => null,
}));

vi.mock("@/components/shared/theme-toggle", () => ({
  ThemeToggle: () => null,
}));

vi.mock("@/context/ProfileContext", () => ({
  useProfile: vi.fn(),
}));

import Header from "./header";
import { useProfile } from "@/context/ProfileContext";

function mockProfile(overrides: {
  isLoaded?: boolean;
  profile?: Profile | null;
}) {
  vi.mocked(useProfile).mockReturnValue({
    profile: overrides.profile ?? null,
    isLoaded: overrides.isLoaded ?? true,
    isOnboarded: !!overrides.profile,
    isAdmin: false,
    error: null,
    refresh: vi.fn(),
    setProfile: vi.fn(),
  });
}

describe("Header onboarding/dashboard CTA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a Get Started CTA to /onboarding for anonymous users", () => {
    mockProfile({ profile: null });

    render(<Header />);

    const cta = screen.getByLabelText("Get started with onboarding");
    expect(cta).toHaveAttribute("href", "/onboarding");
    expect(screen.queryByLabelText("Go to your dashboard")).not.toBeInTheDocument();
  });

  it("replaces the CTA with a Dashboard link for onboarded farmers", () => {
    mockProfile({
      profile: {
        wallet_address: "GTEST",
        role: "farmer",
        display_name: "Farmer",
        bio: null,
        avatar_url: null,
      },
    });

    render(<Header />);

    expect(screen.getByLabelText("Go to your dashboard")).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(
      screen.queryByLabelText("Get started with onboarding"),
    ).not.toBeInTheDocument();
  });

  it("hides both CTAs for onboarded buyers (no buyer dashboard)", () => {
    mockProfile({
      profile: {
        wallet_address: "GTEST",
        role: "buyer",
        display_name: "Buyer",
        bio: null,
        avatar_url: null,
      },
    });

    render(<Header />);

    expect(
      screen.queryByLabelText("Go to your dashboard"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Get started with onboarding"),
    ).not.toBeInTheDocument();
  });
});
