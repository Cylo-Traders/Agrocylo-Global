"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BadgeCheck, Link2, ShieldCheck, UserRoundCog } from "lucide-react";

import ConnectWallet from "@/components/shared/connect-wallet";
import Wrapper from "@/components/shared/wrapper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/hooks/useWallet";
import { useUserProfile } from "@/hooks/useUserProfile";
import type { SocialLink } from "@/services/profileService";

const DEFAULT_SOCIALS: SocialLink[] = [
  { label: "Website", url: "" },
  { label: "X", url: "" },
  { label: "Instagram", url: "" },
];

export default function ProfileSettingsPage() {
  const { address, connected } = useWallet();
  const userId = address ?? "";
  const { profileData, isLoading, saveProfile, isSavingProfile } =
    useUserProfile(userId);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [location, setLocation] = useState("");
  const [showLocation, setShowLocation] = useState(true);
  const [showContactLinks, setShowContactLinks] = useState(true);
  const [verificationRequested, setVerificationRequested] = useState(false);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>(DEFAULT_SOCIALS);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileData) return;
    setDisplayName(profileData.profile.displayName);
    setBio(profileData.profile.bio);
    setAvatarUrl(profileData.profile.avatarUrl ?? "");
    setLocation(profileData.profile.location);
    setShowLocation(profileData.profile.privacy.showLocation);
    setShowContactLinks(profileData.profile.privacy.showContactLinks);
    setVerificationRequested(profileData.profile.verificationRequested);
    setSocialLinks(
      profileData.profile.socialLinks.length > 0
        ? profileData.profile.socialLinks
        : DEFAULT_SOCIALS,
    );
  }, [profileData]);

  const completedLinks = useMemo(
    () => socialLinks.filter((link) => link.label.trim() && link.url.trim()),
    [socialLinks],
  );

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) return;

    setError(null);
    setNotice(null);

    try {
      await saveProfile({
        displayName,
        bio,
        avatarUrl: avatarUrl.trim() || null,
        location,
        socialLinks: completedLinks,
        privacy: {
          showLocation,
          showContactLinks,
        },
        verificationRequested,
      });
      setNotice("Profile saved successfully.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save profile.",
      );
    }
  }

  return (
    <Wrapper className="pt-28 pb-20">
      <div className="space-y-8">
        <PageHeader
          title="Profile settings"
          description="Update your public profile, social links, privacy, and verification request."
        />

        {!connected ? (
          <Card className="rounded-3xl p-6">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Connect your wallet</h2>
                <p className="text-muted-foreground text-sm">
                  Sign in to edit your profile and manage trust settings.
                </p>
              </div>
              <ConnectWallet />
            </div>
          </Card>
        ) : null}

        <form onSubmit={(event) => void handleSave(event)} className="space-y-6">
          <Card className="rounded-3xl p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <UserRoundCog className="text-primary size-5" />
              <h2 className="text-lg font-semibold">Public identity</h2>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <Input
                label="Display name"
                placeholder="Your farm or business name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <Input
                label="Avatar URL"
                placeholder="https://..."
                value={avatarUrl}
                onChange={(event) => setAvatarUrl(event.target.value)}
              />
              <div className="lg:col-span-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="profile-bio">Bio</Label>
                  <Textarea
                    id="profile-bio"
                    placeholder="Tell buyers about your farm, quality standards, and delivery approach."
                    rows={4}
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                  />
                </div>
              </div>
              <Input
                label="Location"
                placeholder="City, Country"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </div>
          </Card>

          <Card className="rounded-3xl p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Link2 className="text-primary size-5" />
              <h2 className="text-lg font-semibold">Social links</h2>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {socialLinks.map((link, index) => (
                <div key={link.label} className="space-y-2">
                  <Label>{link.label}</Label>
                  <Input
                    placeholder={`Add your ${link.label.toLowerCase()} URL`}
                    value={link.url}
                    onChange={(event) => {
                      const next = [...socialLinks];
                      next[index] = { ...next[index], url: event.target.value };
                      setSocialLinks(next);
                    }}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card className="rounded-3xl p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-primary size-5" />
              <h2 className="text-lg font-semibold">Privacy and trust</h2>
            </div>
            <div className="mt-5 space-y-4">
              <SettingRow
                title="Show location"
                description="Display your location on the public profile."
                checked={showLocation}
                onCheckedChange={setShowLocation}
              />
              <Separator />
              <SettingRow
                title="Show social links"
                description="Expose your social and website links to buyers."
                checked={showContactLinks}
                onCheckedChange={setShowContactLinks}
              />
              <Separator />
              <SettingRow
                title="Verification badge request"
                description="Request a review for a badge once your profile is ready."
                checked={verificationRequested}
                onCheckedChange={setVerificationRequested}
              />
            </div>

            <div className="mt-6 rounded-2xl border bg-secondary/25 p-4">
              <div className="flex items-center gap-2">
                <BadgeCheck className="text-primary size-5" />
                <p className="font-medium">Verification request</p>
              </div>
              <p className="text-muted-foreground mt-2 text-sm">
                Profile verification helps surface trusted traders and improves
                buyer confidence.
              </p>
            </div>
          </Card>

          {notice && (
            <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-sm">
              Changes save locally for now and can later sync to your backend profile.
            </p>
            <Button type="submit" isLoading={isLoading || isSavingProfile}>
              Save changes
            </Button>
          </div>
        </form>
      </div>
    </Wrapper>
  );
}

function SettingRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
