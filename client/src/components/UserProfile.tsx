"use client";

import Link from "next/link";
import { useMemo, type ComponentType } from "react";
import {
  Award,
  BadgeCheck,
  CalendarDays,
  ClipboardList,
  Clock3,
  MapPin,
  PencilLine,
  ShieldCheck,
  Star,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import Wrapper from "@/components/shared/wrapper";
import ReviewForm from "@/components/ReviewForm";
import ReviewList from "@/components/ReviewList";
import { cn, getInitials } from "@/lib/utils";
import { formatTruncatedAddress } from "@/lib/helpers/format-address";
import { useWallet } from "@/hooks/useWallet";
import { useUserProfile } from "@/hooks/useUserProfile";

interface UserProfileProps {
  userId: string;
}

function reputationTone(score: number): string {
  if (score >= 95) return "text-emerald-600";
  if (score >= 82) return "text-primary";
  if (score >= 68) return "text-sky-600";
  return "text-muted-foreground";
}

function badgeVariant(score: number): "success" | "default" | "secondary" | "warning" {
  if (score >= 95) return "success";
  if (score >= 82) return "default";
  if (score >= 68) return "warning";
  return "secondary";
}

export default function UserProfile({ userId }: UserProfileProps) {
  const { address, connected } = useWallet();
  const {
    profileData,
    isLoading,
    error,
    submitReview,
    isSubmittingReview,
    voteHelpful,
    respondToReview,
  } = useUserProfile(userId);

  const isOwner = connected && address === userId;

  const reviewPrompt = useMemo(() => {
    if (!connected) return "Connect your wallet to leave a verified review.";
    if (isOwner) return "Open your profile settings to update your own details.";
    return "Leave feedback only after a completed transaction.";
  }, [connected, isOwner]);

  if (isLoading) {
    return (
      <Wrapper className="pt-28 pb-20">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="rounded-3xl p-6">
            <div className="space-y-4">
              <div className="h-20 rounded-2xl bg-muted" />
              <div className="h-8 w-1/2 rounded bg-muted" />
              <div className="h-5 w-3/4 rounded bg-muted" />
              <div className="h-32 rounded-2xl bg-muted" />
            </div>
          </Card>
          <div className="space-y-4">
            <div className="h-40 rounded-3xl bg-muted" />
            <div className="h-56 rounded-3xl bg-muted" />
          </div>
        </div>
      </Wrapper>
    );
  }

  if (error || !profileData) {
    return (
      <Wrapper className="pt-28 pb-20">
        <div className="rounded-3xl border bg-card p-8 text-center">
          <h1 className="text-2xl font-semibold">Profile unavailable</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {error instanceof Error ? error.message : "We couldn't load this profile."}
          </p>
        </div>
      </Wrapper>
    );
  }

  const { profile, stats, reputation, trustIndicators, activityTimeline, reviews } =
    profileData;

  return (
    <Wrapper className="pt-28 pb-20">
      <div className="space-y-8">
        <section className="overflow-hidden rounded-[2rem] border bg-card shadow-sm">
          <div className="bg-gradient-to-r from-primary/10 via-secondary/30 to-background px-5 py-6 sm:px-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <Avatar className="size-20 border border-border shadow-sm">
                  <AvatarImage src={profile.avatarUrl ?? undefined} alt={profile.displayName} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xl font-semibold">
                    {getInitials(profile.displayName)}
                  </AvatarFallback>
                </Avatar>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-3xl font-bold tracking-tight">
                      {profile.displayName}
                    </h1>
                    <Badge variant={profile.role === "farmer" ? "success" : "secondary"}>
                      {profile.role === "farmer" ? profile.sellerBadge : profile.buyerBadge}
                    </Badge>
                    {profile.verificationRequested && (
                      <Badge variant="warning" className="gap-1">
                        <BadgeCheck className="size-3.5" />
                        Verification requested
                      </Badge>
                    )}
                  </div>

                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {profile.bio}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-4" />
                      {profile.privacy.showLocation ? profile.location : "Location private"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="size-4" />
                      Member since {profile.memberSince}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      <Wallet className="size-4" />
                      {formatTruncatedAddress(userId)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-3xl border bg-background/80 p-5 sm:min-w-[16rem]">
                <div className="flex items-center gap-2">
                  <Badge variant={badgeVariant(reputation.score)}>
                    {reputation.badge}
                  </Badge>
                  <span className={cn("text-3xl font-black", reputationTone(reputation.score))}>
                    {reputation.score}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium">Reputation score</p>
                  <p className="text-muted-foreground text-xs">{reputation.badgeDescription}</p>
                </div>
                <Progress value={reputation.score} className="h-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>0</span>
                  <span>100</span>
                </div>
                {isOwner ? (
                  <Button asChild className="w-full">
                    <Link href="/profile/settings">
                      <PencilLine className="size-4" />
                      Manage profile
                    </Link>
                  </Button>
                ) : (
                  <Button asChild variant="outline" className="w-full">
                    <Link href={`/orders/new?farmer=${userId}`}>
                      <ClipboardList className="size-4" />
                      Create order
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-5 py-6 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total sales"
              value={stats.totalSales}
              icon={TrendingUp}
              helper="Completed seller transactions"
            />
            <MetricCard
              label="Average rating"
              value={stats.averageRating.toFixed(1)}
              icon={Star}
              helper={`${stats.reviewCount} verified review${stats.reviewCount === 1 ? "" : "s"}`}
            />
            <MetricCard
              label="Response rate"
              value={`${stats.responseRate}%`}
              icon={Clock3}
              helper={`${stats.responseTimeHours}h avg response`}
            />
            <MetricCard
              label="On-time delivery"
              value={`${stats.onTimeDeliveryRate}%`}
              icon={ShieldCheck}
              helper={`${stats.transactionCount} transactions tracked`}
            />
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-6">
            <Card className="rounded-3xl p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Award className="text-primary size-5" />
                <h2 className="text-lg font-semibold">Trust indicators</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {trustIndicators.map((item) => (
                  <div key={item.label} className="rounded-2xl bg-secondary/30 p-4">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-lg font-semibold">{item.value}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="rounded-3xl p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="text-primary size-5" />
                <h2 className="text-lg font-semibold">Reputation history</h2>
              </div>
              <div className="mt-4 space-y-4">
                {reputation.history.map((entry) => (
                  <div key={entry.label} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{entry.label}</span>
                      <span className="text-muted-foreground">{entry.score}</span>
                    </div>
                    <Progress value={entry.score} className="h-1.5" />
                    <p className="text-xs text-muted-foreground">{entry.note}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="rounded-3xl p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <CalendarDays className="text-primary size-5" />
                <h2 className="text-lg font-semibold">Activity timeline</h2>
              </div>
              <div className="mt-5 space-y-4">
                {activityTimeline.map((entry) => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="mt-1 size-3 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{entry.title}</p>
                        <Badge variant="outline">{entry.kind}</Badge>
                      </div>
                      <p className="text-muted-foreground mt-1 text-sm">{entry.description}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {new Date(entry.occurredAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <ReviewList
              reviews={reviews}
              isOwner={isOwner}
              currentUserName={profile.displayName}
              onHelpfulVote={
                connected && address
                  ? (reviewId) => void voteHelpful({ reviewId, voterWallet: address })
                  : undefined
              }
              onRespond={
                isOwner
                  ? (reviewId, response) => {
                      void respondToReview({
                        reviewId,
                        response,
                        responderName: profile.displayName,
                      });
                    }
                  : undefined
              }
            />

            {connected && address && !isOwner ? (
              <ReviewForm
                reviewerName={formatTruncatedAddress(address)}
                reviewerRole={profile.role === "farmer" ? "buyer" : "farmer"}
                reviewerWallet={address}
                onSubmit={(draft) => void submitReview(draft)}
                isSubmitting={isSubmittingReview}
              />
            ) : isOwner ? (
              <Card className="rounded-3xl p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="text-primary size-5" />
                  <h3 className="text-lg font-semibold">Your own profile</h3>
                </div>
                <p className="text-muted-foreground mt-3 text-sm">
                  You cannot review your own profile. Use the settings page to
                  update your details and let buyers leave verified feedback.
                </p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href="/profile/settings">
                    <PencilLine className="size-4" />
                    Manage profile
                  </Link>
                </Button>
              </Card>
            ) : (
              <Card className="rounded-3xl p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <Wallet className="text-primary size-5" />
                  <h3 className="text-lg font-semibold">Connect to review</h3>
                </div>
                <p className="text-muted-foreground mt-3 text-sm">{reviewPrompt}</p>
              </Card>
            )}

            <Card className="rounded-3xl p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <BadgeCheck className="text-primary size-5" />
                <h2 className="text-lg font-semibold">Profile summary</h2>
              </div>
              <Separator className="my-4" />
              <div className="grid gap-4 sm:grid-cols-2">
                <SummaryRow label="Reviews" value={stats.reviewCount} />
                <SummaryRow label="Helpful votes" value={stats.helpfulVotesReceived} />
                <SummaryRow label="Purchases" value={stats.totalPurchases} />
                <SummaryRow label="Sales" value={stats.totalSales} />
              </div>
              <p className="text-muted-foreground mt-4 text-xs">
                {reviewPrompt}
              </p>
            </Card>
          </div>
        </section>
      </div>
    </Wrapper>
  );
}

function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  helper: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-3xl border bg-background p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs">{label}</p>
          <p className="mt-2 text-2xl font-bold">{value}</p>
        </div>
        <div className="grid size-11 place-content-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">{helper}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-secondary/30 p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
