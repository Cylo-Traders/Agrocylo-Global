"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface ProfileFormProps {
  displayName: string;
  bio: string;
  onUpdate: (data: { displayName: string; bio: string }) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function ProfileForm({
  displayName,
  bio,
  onUpdate,
  onNext,
  onBack,
}: ProfileFormProps) {
  const [nameError, setNameError] = useState("");

  function handleNext() {
    if (!displayName.trim()) {
      setNameError("Display name is required");
      return;
    }
    setNameError("");
    onNext();
  }

  return (
    <Card variant="elevated" padding="lg" className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-foreground mb-2 text-center">
        Your Profile
      </h2>
      <p className="text-muted text-sm mb-6 text-center">
        Tell others about yourself.
      </p>

      <div className="space-y-4">
        <Input
          label="Display Name"
          placeholder="e.g. John's Farm"
          value={displayName}
          onChange={(e) => {
            onUpdate({ displayName: e.target.value, bio });
            if (nameError) setNameError("");
          }}
          error={nameError}
        />

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Bio (optional)
          </label>
          <textarea
            className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm text-foreground placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-600 dark:bg-neutral-800"
            placeholder="Organic tomatoes and peppers from Lagos..."
            rows={3}
            maxLength={280}
            value={bio}
            onChange={(e) => onUpdate({ displayName, bio: e.target.value })}
          />
          <p className="mt-1 text-xs text-neutral-400 text-right">
            {bio.length}/280
          </p>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <Button variant="outline" fullWidth onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" fullWidth onClick={handleNext}>
          Continue
        </Button>
      </div>
    </Card>
  );
}
