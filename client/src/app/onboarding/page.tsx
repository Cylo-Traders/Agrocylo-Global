"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import { createProfile, registerLocation } from "@/lib/profileApi";
import StepProgress from "@/components/onboarding/StepProgress";
import ConnectWallet from "@/components/onboarding/ConnectWallet";
import SelectRole from "@/components/onboarding/SelectRole";
import ProfileForm from "@/components/onboarding/ProfileForm";
import LocationConsent from "@/components/onboarding/LocationConsent";
import Complete from "@/components/onboarding/Complete";

export default function OnboardingPage() {
  const router = useRouter();
  const { address } = useWallet();

  const [step, setStep] = useState(1);
  const [role, setRole] = useState<"farmer" | "buyer" | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLocationComplete(
    location: {
      latitude: number;
      longitude: number;
      city: string;
      country: string;
      isPublic: boolean;
    } | null
  ) {
    if (!address || !role) return;
    setIsSubmitting(true);
    setError(null);

    try {
      await createProfile(
        {
          role,
          display_name: displayName.trim(),
          bio: bio.trim() || undefined,
        },
        address
      );

      if (location) {
        await registerLocation(
          {
            latitude: location.latitude,
            longitude: location.longitude,
            city: location.city || null,
            country: location.country || null,
            is_public: location.isPublic,
          },
          address
        );
      }

      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white py-12 px-4">
      <StepProgress currentStep={step} />

      {error && (
        <div className="mx-auto max-w-md mb-4 rounded-lg bg-red-100 px-4 py-2 text-sm text-red-800">
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
          onNext={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}

      {step === 4 && (
        <LocationConsent
          onComplete={handleLocationComplete}
          onBack={() => setStep(3)}
          isSubmitting={isSubmitting}
        />
      )}

      {step === 5 && role && <Complete role={role} />}
    </div>
  );
}
