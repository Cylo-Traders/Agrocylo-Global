"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Connect Wallet", "Select Role", "Profile", "Location", "Done"];

interface StepProgressProps {
  currentStep: number;
}

export default function StepProgress({ currentStep }: StepProgressProps) {
  return (
    <div className="mb-10 flex items-center justify-center gap-2">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isComplete = step < currentStep;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "grid size-11 place-content-center rounded-full text-sm font-semibold transition-colors",
                  isComplete && "bg-primary text-primary-foreground",
                  isActive && "bg-primary/10 text-primary ring-2 ring-primary",
                  !isActive && !isComplete && "bg-muted text-muted-foreground",
                )}
              >
                {isComplete ? <Check className="size-4" /> : step}
              </div>
              <span className="text-muted-foreground mt-1.5 hidden text-xs sm:block">
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-0.5 w-4 sm:w-10",
                  isComplete ? "bg-primary" : "bg-muted",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
