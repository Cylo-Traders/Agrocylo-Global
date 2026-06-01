"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { X } from "lucide-react";
import WelcomeStep from "./WelcomeStep";
import ConnectWalletStep from "./ConnectWalletStep";
import ChooseRoleStep from "./ChooseRoleStep";
import FirstTransactionStep from "./FirstTransactionStep";

export type OnboardingStep =
  | "welcome"
  | "wallet"
  | "role"
  | "transaction"
  | "complete";

interface OnboardingFlowProps {
  onComplete: () => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [selectedRole, setSelectedRole] = useState<"BUYER" | "FARMER" | null>(
    null,
  );

  useEffect(() => {
    // Check if user has completed onboarding
    const hasCompletedOnboarding = localStorage.getItem("onboarding_completed");
    const savedStep = localStorage.getItem(
      "onboarding_step",
    ) as OnboardingStep | null;

    if (!hasCompletedOnboarding) {
      setOpen(true);
      if (savedStep) {
        setCurrentStep(savedStep);
      }
    }
  }, []);

  const steps: OnboardingStep[] = ["welcome", "wallet", "role", "transaction"];
  const currentStepIndex = steps.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      const nextStep = steps[nextIndex];
      setCurrentStep(nextStep);
      localStorage.setItem("onboarding_step", nextStep);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      const prevStep = steps[prevIndex];
      setCurrentStep(prevStep);
      localStorage.setItem("onboarding_step", prevStep);
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleComplete = () => {
    localStorage.setItem("onboarding_completed", "true");
    localStorage.removeItem("onboarding_step");
    setOpen(false);
    onComplete();
  };

  const handleRoleSelect = (role: "BUYER" | "FARMER") => {
    setSelectedRole(role);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="relative">
          {/* Skip button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0"
            onClick={handleSkip}
          >
            <X className="h-4 w-4" />
          </Button>

          {/* Progress bar */}
          <div className="mb-6 mt-8">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-muted-foreground mt-2 text-center">
              Step {currentStepIndex + 1} of {steps.length}
            </p>
          </div>

          {/* Step content */}
          <div className="min-h-[400px]">
            {currentStep === "welcome" && (
              <WelcomeStep onNext={handleNext} onSkip={handleSkip} />
            )}
            {currentStep === "wallet" && (
              <ConnectWalletStep
                onNext={handleNext}
                onBack={handleBack}
                onSkip={handleSkip}
              />
            )}
            {currentStep === "role" && (
              <ChooseRoleStep
                onNext={handleNext}
                onBack={handleBack}
                onSkip={handleSkip}
                onRoleSelect={handleRoleSelect}
                selectedRole={selectedRole}
              />
            )}
            {currentStep === "transaction" && (
              <FirstTransactionStep
                onComplete={handleComplete}
                onBack={handleBack}
                onSkip={handleSkip}
                role={selectedRole || "BUYER"}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
