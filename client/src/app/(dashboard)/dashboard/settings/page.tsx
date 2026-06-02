"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { NotificationPreferences } from "@/components/NotificationPreferences";
import { useProfile } from "@/context/ProfileContext";
import { useWallet } from "@/hooks/useWallet";
import { updateProfile } from "@/services/profileService";

const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 100;
const BIO_MAX = 500;

function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < DISPLAY_NAME_MIN) {
    return `Display name must be at least ${DISPLAY_NAME_MIN} characters.`;
  }
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return `Display name must be at most ${DISPLAY_NAME_MAX} characters.`;
  }
  return null;
}

function validateBio(value: string): string | null {
  if (value.length > BIO_MAX) {
    return `Bio must be at most ${BIO_MAX} characters.`;
  }
  return null;
}

export default function SettingsPage() {
  const { profile, setProfile } = useProfile();
  const { address } = useWallet();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setBio(profile.bio ?? "");
    setDisplayNameError(null);
    setBioError(null);
    setSaveError(null);
  }, [profile?.wallet_address, profile?.display_name, profile?.bio]);

  const isDirty = useMemo(() => {
    if (!profile) return false;
    return (
      displayName.trim() !== (profile.display_name ?? "").trim() ||
      bio.trim() !== (profile.bio ?? "").trim()
    );
  }, [profile, displayName, bio]);

  const isValid = useMemo(() => {
    return !validateDisplayName(displayName) && !validateBio(bio);
  }, [displayName, bio]);

  const canSave = isDirty && isValid && !isSaving && !!address;

  async function handleSave() {
    const nameErr = validateDisplayName(displayName);
    const bioErr = validateBio(bio);
    setDisplayNameError(nameErr);
    setBioError(bioErr);
    if (nameErr || bioErr || !address) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const updated = await updateProfile(address, {
        display_name: displayName.trim(),
        bio: bio.trim() || null,
      });
      setProfile(updated);
      toast.success("Profile updated");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save profile";
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage your profile, wallet, and notification preferences."
      />

      <section className="rounded-2xl border bg-card p-6">
        <h2 className="mb-1 font-semibold">Profile</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          How buyers see you on the marketplace.
        </p>

        <div className="grid max-w-2xl gap-5">
          <Input
            label="Display Name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setDisplayNameError(validateDisplayName(e.target.value));
              setSaveError(null);
            }}
            placeholder="Your farm or business name"
            error={displayNameError ?? undefined}
          />
          <div>
            <Label htmlFor="bio" className="mb-2 block text-sm">
              Bio
            </Label>
            <Textarea
              id="bio"
              placeholder="Tell buyers about your farm…"
              value={bio}
              rows={3}
              onChange={(e) => {
                setBio(e.target.value);
                setBioError(validateBio(e.target.value));
                setSaveError(null);
              }}
              aria-invalid={!!bioError}
              className={bioError ? "border-destructive" : undefined}
            />
            {bioError && (
              <p className="text-destructive mt-1.5 text-sm" role="alert">
                {bioError}
              </p>
            )}
          </div>
          {saveError && (
            <p className="text-destructive text-sm" role="alert">
              {saveError}
            </p>
          )}
          <div className="flex justify-end">
            <Button disabled={!canSave} onClick={() => void handleSave()}>
              {isSaving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6">
        <h2 className="mb-1 font-semibold">Wallet</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Stellar address linked to your profile.
        </p>

        <div className="grid max-w-2xl gap-5">
          <div>
            <Label className="text-xs">Connected Address</Label>
            <p className="mt-1.5 break-all font-mono text-sm">
              {address ?? "Not connected"}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6">
        <h2 className="mb-1 font-semibold">Notifications</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          What you want to be notified about and how we deliver alerts.
        </p>
        <NotificationPreferences embedded />
      </section>
    </div>
  );
}
