"use client";

import { useEffect, useState } from "react";
import { Copy, Gift, Share2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getReferralCode,
  getCohortPerformance,
  type ReferralCode,
  type ReferralCohortPerformance,
} from "@/services/referralService";

interface ReferralCodeDisplayProps {
  walletAddress: string;
}

export function ReferralCodeDisplay({
  walletAddress,
}: ReferralCodeDisplayProps) {
  const [referralData, setReferralData] = useState<ReferralCode | null>(null);
  const [cohortData, setCohortData] =
    useState<ReferralCohortPerformance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReferralData() {
      if (!walletAddress) return;

      setIsLoading(true);
      setError(null);

      try {
        const [codeData, perfData] = await Promise.all([
          getReferralCode(walletAddress),
          getCohortPerformance(walletAddress),
        ]);

        setReferralData(codeData);
        setCohortData(perfData.performance);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load referral data",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadReferralData();
  }, [walletAddress]);

  async function copyToClipboard() {
    if (!referralData) return;

    try {
      await navigator.clipboard.writeText(referralData.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }

  async function shareReferralLink() {
    if (!referralData) return;

    const url = `${window.location.origin}/onboarding?ref=${referralData.code}`;
    const text = `Join AgroCylo with my referral code: ${referralData.code}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "AgroCylo Referral", text, url });
      } catch (err) {
        // User cancelled or error
      }
    } else {
      // Fallback: copy link
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (isLoading) {
    return (
      <Card className="rounded-3xl p-5 sm:p-6">
        <div className="bg-secondary/50 rounded-lg h-32 animate-pulse" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="rounded-3xl p-5 sm:p-6">
        <div className="text-destructive flex items-center gap-2">
          <p className="text-sm">{error}</p>
        </div>
      </Card>
    );
  }

  if (!referralData) return null;

  return (
    <Card className="rounded-3xl p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Gift className="text-primary size-5" />
        <h2 className="text-lg font-semibold">Referral Program</h2>
      </div>

      <p className="text-muted-foreground mt-2 text-sm">
        Share your referral code and earn fee credits when new users join and
        transact.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium">
            Your Referral Code
          </p>
          <div className="flex gap-2">
            <div className="bg-secondary flex-1 rounded-lg border px-4 py-3 font-mono text-lg font-semibold">
              {referralData.code}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={copyToClipboard}
              title="Copy code"
            >
              <Copy className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={shareReferralLink}
              title="Share referral link"
            >
              <Share2 className="size-4" />
            </Button>
          </div>
          {copied && (
            <p className="text-primary mt-2 text-xs font-medium">
              Copied to clipboard!
            </p>
          )}
        </div>

        {cohortData && (
          <>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border bg-secondary/25 p-4">
                <div className="flex items-center gap-2">
                  <Users className="text-primary size-4" />
                  <p className="text-muted-foreground text-xs font-medium">
                    Onboarded
                  </p>
                </div>
                <p className="mt-1 text-2xl font-bold">
                  {cohortData.onboardedCount}
                </p>
              </div>

              <div className="rounded-xl border bg-secondary/25 p-4">
                <div className="flex items-center gap-2">
                  <Users className="text-primary size-4" />
                  <p className="text-muted-foreground text-xs font-medium">
                    Transacting
                  </p>
                </div>
                <p className="mt-1 text-2xl font-bold">
                  {cohortData.transactingCount}
                </p>
              </div>

              <div className="rounded-xl border bg-secondary/25 p-4">
                <div className="flex items-center gap-2">
                  <Gift className="text-primary size-4" />
                  <p className="text-muted-foreground text-xs font-medium">
                    Rewards
                  </p>
                </div>
                <p className="mt-1 text-2xl font-bold">
                  {cohortData.rewardVolume} XLM
                </p>
              </div>
            </div>
          </>
        )}

        <div className="bg-secondary/25 rounded-xl border p-4">
          <p className="text-muted-foreground text-sm">
            <strong>Fee Credit Balance:</strong> {referralData.feeCreditBalance}{" "}
            XLM
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Fee credits are automatically applied to reduce platform fees on
            your orders.
          </p>
        </div>
      </div>
    </Card>
  );
}
