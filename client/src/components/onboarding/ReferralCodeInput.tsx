"use client";

import { useState } from "react";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

interface ReferralCodeInputProps {
  onSubmit: (code: string) => void;
  onSkip: () => void;
  isSubmitting?: boolean;
}

export default function ReferralCodeInput({
  onSubmit,
  onSkip,
  isSubmitting = false,
}: ReferralCodeInputProps) {
  const [code, setCode] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }

  return (
    <Card className="rounded-3xl p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="bg-primary/10 rounded-full p-3">
          <Gift className="text-primary size-6" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Referral Code (Optional)</h2>
          <p className="text-muted-foreground text-sm">
            Enter a referral code if you have one to unlock rewards.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="referral-code">Referral Code</Label>
          <Input
            id="referral-code"
            placeholder="e.g. FARM123"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={20}
          />
          <p className="text-muted-foreground text-xs">
            Referral codes are case-insensitive and alphanumeric.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="submit"
            disabled={!code.trim() || isSubmitting}
            isLoading={isSubmitting}
            className="flex-1"
          >
            Apply Code
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            disabled={isSubmitting}
            className="flex-1"
          >
            Skip for Now
          </Button>
        </div>
      </form>

      <div className="bg-secondary/50 mt-6 rounded-xl p-4">
        <p className="text-muted-foreground text-sm">
          <strong>Tip:</strong> Referral codes help farmers earn rewards when
          new users sign up and transact on the platform.
        </p>
      </div>
    </Card>
  );
}
