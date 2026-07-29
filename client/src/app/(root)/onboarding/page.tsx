"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import { useProfile } from "@/context/ProfileContext";
import { useAnalytics } from "@/hooks/useAnalytics";
import { createProfile, registerLocation } from "@/services/profileService";
import { submitReferralCode } from "@/services/referralService";
import StepProgress from "@/components/onboarding/StepProgress";
import ConnectWallet from "@/components/onboarding/ConnectWallet";
import SelectRole from "@/components/onboarding/SelectRole";
import ProfileForm from "@/components/onboarding/ProfileForm";
import ReferralCodeInput from "@/components/onboarding/ReferralCodeInput";
import LocationConsent from "@/components/onboarding/LocationConsent";
import Complete from "@/components/onboarding/Complete";

export default function OnboardingPage() {
  const searchParams = useSearchParams();
  const { address } = useWallet();
  const { setProfile } = useProfile();
  const { trackFunnelStep, trackFeatureAdoption } = useAnalytics();

  const referralFromUrl = searchParams?.get("ref") || "";
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<"farmer" | "buyer" | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [referralCode, setReferralCode] = useState(referralFromUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function isNetworkFetchError(err: unknown): boolean {
    return (
      err instanceof TypeError ||
      (err instanceof Error &&
        /failed to fetch|networkerror|fetch failed/i.test(err.message))
    );
  }

  useEffect(() => {
    trackFunnelStep("onboarding_completion", "started", {
      step,
    });
  }, [step, trackFunnelStep]);

  useEffect(() => {
    trackFeatureAdoption("onboarding_flow", {
      step,
    });
  }, [step, trackFeatureAdoption]);

  async function handleReferralSubmit(code: string) {
    setReferralCode(code);
    setStep(5);
  }

  function skipReferral() {
    setStep(5);
  }

  async function handleLocationComplete(
    location: {
      latitude: number;
      longitude: number;
      city: string;
      country: string;
      isPublic: boolean;
    } | null,
  ) {
    if (!address || !role) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const created = await createProfile(
        {
          role,
          display_name: displayName.trim(),
          bio: bio.trim() || undefined,
        },
        address,
      );
      // Seed the profile cache so AuthGuard sees the user as onboarded immediately,
      // without waiting for a refetch round-trip.
      setProfile(created);

      if (location) {
        try {
          await registerLocation(
            {
              lat: location.latitude,
              lng: location.longitude,
              city: location.city || null,
              country: location.country || null,
              is_public: location.isPublic,
            },
            address,
          );
        } catch (locationError) {
          console.error("Location registration failed", locationError);
          trackFunnelStep("onboarding_completion", "location_save_failed", {
            reason:
              locationError instanceof Error
                ? locationError.message
                : "unknown",
          });
        }
      }

      // Submit referral code if provided
      if (referralCode.trim()) {
        try {
          await submitReferralCode(referralCode.trim(), address);
          trackFunnelStep("onboarding_completion", "referral_code_submitted", {
            hasReferral: true,
          });
        } catch (refError) {
          console.error("Referral code submission failed", refError);
          // Don't block completion on referral failure
        }
      }

      trackFunnelStep("onboarding_completion", "completed", {
        role,
        hasLocation: Boolean(location),
        hasReferral: Boolean(referralCode.trim()),
      });
      setStep(6);
    } catch (err) {
      if (isNetworkFetchError(err)) {
        setProfile({
          wallet_address: address,
          role,
          display_name: displayName.trim(),
          bio: bio.trim() || null,
          avatar_url: null,
        });
        trackFunnelStep("onboarding_completion", "completed_offline", {
          role,
          hasLocation: Boolean(location),
        });
        setStep(6);
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="from-secondary/30 to-background flex min-h-screen flex-col items-center bg-gradient-to-b px-4 pt-32 pb-16 md:pt-40">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Welcome to AgroCylo 🌾
          </h1>
          <p className="text-muted-foreground mt-2 text-sm md:text-base">
            A few quick steps to set up your profile.
          </p>
        </div>

        <StepProgress currentStep={step} />

        {error && (
          <div className="bg-destructive/10 text-destructive border-destructive/30 mx-auto mb-4 max-w-md rounded-lg border px-4 py-2 text-sm">
            {error}
          </div>
        )}

        {step === 1 && <ConnectWallet onNext={() => setStep(2)} />}

        {step === 2 && (
          <SelectRole
            selected={role}
            onSelect={setRole}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <ProfileForm
            displayName={displayName}
            bio={bio}
            onUpdate={(data) => {
              setDisplayName(data.displayName);
              setBio(data.bio);
            }}
            onNext={() => {
              // Skip referral step if no ref param and go straight to location
              if (!searchParams?.get("ref")) {
                setStep(5);
              } else {
                setStep(4);
              }
            }}
            onBack={() => setStep(2)}
          />
        )}

        {step === 4 && (
          <ReferralCodeInput
            onSubmit={handleReferralSubmit}
            onSkip={skipReferral}
            isSubmitting={false}
          />
        )}

        {step === 5 && (
          <LocationConsent
            onComplete={handleLocationComplete}
            onBack={() => {
              // If we skipped referral step, go back to profile (step 3)
              if (!referralFromUrl) {
                setStep(3);
              } else {
                setStep(4);
              }
            }}
            isSubmitting={isSubmitting}
          />
        )}

        {step === 6 && role && <Complete role={role} />}
      </div>
    </div>
  );
}
