"use client";

const STEPS = ["Connect Wallet", "Select Role", "Profile", "Location", "Done"];

interface StepProgressProps {
  currentStep: number;
}

export default function StepProgress({ currentStep }: StepProgressProps) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isComplete = step < currentStep;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  isComplete
                    ? "bg-primary-600 text-white"
                    : isActive
                      ? "bg-primary-100 text-primary-700 ring-2 ring-primary-500"
                      : "bg-neutral-200 text-neutral-500"
                }`}
              >
                {isComplete ? "✓" : step}
              </div>
              <span className="mt-1 text-xs text-neutral-500 hidden sm:block">
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-6 sm:w-10 ${
                  isComplete ? "bg-primary-500" : "bg-neutral-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
