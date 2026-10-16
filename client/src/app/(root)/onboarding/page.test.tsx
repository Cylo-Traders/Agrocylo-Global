import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: vi.fn(),
}));

vi.mock("@/context/ProfileContext", () => ({
  useProfile: vi.fn(),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    trackFunnelStep: vi.fn(),
    trackFeatureAdoption: vi.fn(),
  }),
}));

vi.mock("@/services/profileService", () => ({
  createProfile: vi.fn(),
  registerLocation: vi.fn(),
}));

vi.mock("@/services/referralService", () => ({
  submitReferralCode: vi.fn(),
}));

vi.mock("@/components/onboarding/StepProgress", () => ({
  default: () => <div data-testid="step-progress" />,
}));
vi.mock("@/components/onboarding/ConnectWallet", () => ({
  default: ({ onNext }: { onNext: () => void }) => (
    <button onClick={onNext}>connect-next</button>
  ),
}));
vi.mock("@/components/onboarding/SelectRole", () => ({
  default: ({
    onSelect,
    onNext,
  }: {
    onSelect: (role: "farmer") => void;
    onNext: () => void;
  }) => (
    <button
      onClick={() => {
        onSelect("farmer");
        onNext();
      }}
    >
      role-next
    </button>
  ),
}));
vi.mock("@/components/onboarding/ProfileForm", () => ({
  default: ({ onNext }: { onNext: () => void }) => (
    <button onClick={onNext}>profile-next</button>
  ),
}));
vi.mock("@/components/onboarding/ReferralCodeInput", () => ({
  default: () => null,
}));
vi.mock("@/components/onboarding/LocationConsent", () => ({
  default: ({ onComplete }: { onComplete: (v: null) => void }) => (
    <button onClick={() => onComplete(null)}>finish</button>
  ),
}));
vi.mock("@/components/onboarding/Complete", () => ({
  default: () => <div data-testid="complete" />,
}));

import OnboardingPage from "./page";
import { useWallet } from "@/hooks/useWallet";
import { useProfile } from "@/context/ProfileContext";
import { createProfile } from "@/services/profileService";

const farmerProfile = {
  wallet_address: "GTEST",
  role: "farmer" as const,
  display_name: "Farmer",
  bio: null,
  avatar_url: null,
};

function fillProfileContext() {
  const setProfile = vi.fn();
  vi.mocked(useProfile).mockReturnValue({
    profile: null,
    isLoaded: true,
    isOnboarded: false,
    isAdmin: false,
    error: null,
    refresh: vi.fn(),
    setProfile,
  });
  return setProfile;
}

describe("Onboarding completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWallet).mockReturnValue({
      address: "GTEST",
      reauthenticate: vi.fn().mockResolvedValue(undefined),
    } as ReturnType<typeof useWallet>);
    vi.mocked(createProfile).mockResolvedValue(farmerProfile);
  });

  it("seeds the profile and never redirects back to /onboarding", async () => {
    const setProfile = fillProfileContext();

    render(<OnboardingPage />);

    fireEvent.click(screen.getByText("connect-next"));
    fireEvent.click(screen.getByText("role-next"));
    fireEvent.click(screen.getByText("profile-next"));
    fireEvent.click(screen.getByText("finish"));

    await waitFor(() => {
      expect(createProfile).toHaveBeenCalled();
    });

    expect(setProfile).toHaveBeenCalledWith(farmerProfile);
    expect(mockReplace).not.toHaveBeenCalledWith("/onboarding");
    await waitFor(() => {
      expect(screen.getByTestId("complete")).toBeInTheDocument();
    });
  });
});
