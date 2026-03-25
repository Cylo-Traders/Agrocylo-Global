"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface SelectRoleProps {
  selected: "farmer" | "buyer" | null;
  onSelect: (role: "farmer" | "buyer") => void;
  onNext: () => void;
  onBack: () => void;
}

export default function SelectRole({
  selected,
  onSelect,
  onNext,
  onBack,
}: SelectRoleProps) {
  return (
    <Card variant="elevated" padding="lg" className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-foreground mb-2 text-center">
        Choose Your Role
      </h2>
      <p className="text-muted text-sm mb-6 text-center">
        This cannot be changed later.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <button
          onClick={() => onSelect("farmer")}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 p-6 transition-colors ${
            selected === "farmer"
              ? "border-primary-500 bg-primary-50"
              : "border-neutral-200 hover:border-neutral-300"
          }`}
        >
          <span className="text-4xl">🌾</span>
          <span className="font-semibold text-foreground">I am a Farmer</span>
          <span className="text-xs text-muted">Sell produce via escrow</span>
        </button>

        <button
          onClick={() => onSelect("buyer")}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 p-6 transition-colors ${
            selected === "buyer"
              ? "border-accent bg-accent/5"
              : "border-neutral-200 hover:border-neutral-300"
          }`}
        >
          <span className="text-4xl">🛒</span>
          <span className="font-semibold text-foreground">I am a Buyer</span>
          <span className="text-xs text-muted">Buy from local farmers</span>
        </button>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" fullWidth onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          fullWidth
          disabled={!selected}
          onClick={onNext}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}
