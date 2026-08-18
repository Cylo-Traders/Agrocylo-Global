"use client";

import { useEffect, useState } from "react";
import { Gift, TrendingUp, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/apiHelper";

interface CohortPerformance {
  onboardedCount: number;
  transactingCount: number;
  rewardVolume: string;
}

interface ReferralEntry {
  id: string;
  referredWallet: string;
  referralCode: string;
  signedUpAt: string;
  hasTransacted: boolean;
}

export default function AdminReferralsPage() {
  const [globalPerformance, setGlobalPerformance] =
    useState<CohortPerformance | null>(null);
  const [filterWallet, setFilterWallet] = useState("");
  const [filteredPerformance, setFilteredPerformance] =
    useState<CohortPerformance | null>(null);
  const [referrals, setReferrals] = useState<ReferralEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadGlobalData() {
      setIsLoading(true);
      setError(null);

      try {
        const data = await apiGet<CohortPerformance>("/admin/referrals/cohort");
        setGlobalPerformance(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load referral data",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadGlobalData();
  }, []);

  async function handleFilter() {
    if (!filterWallet.trim()) {
      setFilteredPerformance(null);
      setReferrals([]);
      return;
    }

    setIsFiltering(true);
    setError(null);

    try {
      const [performance, referralList] = await Promise.all([
        apiGet<CohortPerformance>(
          `/admin/referrals/cohort?referrerWallet=${encodeURIComponent(filterWallet.trim())}`,
        ),
        apiGet<ReferralEntry[]>(
          `/admin/referrals/${encodeURIComponent(filterWallet.trim())}`,
        ),
      ]);

      setFilteredPerformance(performance);
      setReferrals(referralList);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to filter referrals",
      );
    } finally {
      setIsFiltering(false);
    }
  }

  function clearFilter() {
    setFilterWallet("");
    setFilteredPerformance(null);
    setReferrals([]);
  }

  const displayPerformance = filteredPerformance || globalPerformance;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Referral Program"
        description="Monitor referral cohort performance and reward distribution across the platform."
      />

      {error && (
        <div className="bg-destructive/10 border-destructive/30 rounded-lg border p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-2xl border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Filter by Referrer</h2>
        <div className="flex gap-3">
          <Input
            placeholder="Enter referrer wallet address"
            value={filterWallet}
            onChange={(e) => setFilterWallet(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleFilter();
              }
            }}
          />
          <Button onClick={handleFilter} isLoading={isFiltering}>
            Filter
          </Button>
          {filteredPerformance && (
            <Button variant="outline" onClick={clearFilter}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-secondary/50 rounded-lg border h-32 animate-pulse"
            />
          ))}
        </div>
      ) : displayPerformance ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="rounded-2xl p-6">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 rounded-full p-3">
                <Users className="text-primary size-5" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-medium">
                  Onboarded
                </p>
                <p className="text-3xl font-bold">
                  {displayPerformance.onboardedCount}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
              {filteredPerformance
                ? "Referred by this wallet"
                : "Platform-wide"}
            </p>
          </Card>

          <Card className="rounded-2xl p-6">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 rounded-full p-3">
                <TrendingUp className="text-primary size-5" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-medium">
                  Transacting
                </p>
                <p className="text-3xl font-bold">
                  {displayPerformance.transactingCount}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
              Active users completing orders
            </p>
          </Card>

          <Card className="rounded-2xl p-6">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 rounded-full p-3">
                <Gift className="text-primary size-5" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-medium">
                  Reward Volume
                </p>
                <p className="text-3xl font-bold">
                  {displayPerformance.rewardVolume}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
              XLM distributed as fee credits
            </p>
          </Card>
        </div>
      ) : null}

      {referrals.length > 0 && (
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">
            Referrals ({referrals.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 font-medium">Wallet</th>
                  <th className="text-left py-3 font-medium">Code Used</th>
                  <th className="text-left py-3 font-medium">Signed Up</th>
                  <th className="text-left py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((ref) => (
                  <tr
                    key={ref.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="py-3 font-mono text-xs">
                      {ref.referredWallet.slice(0, 6)}...
                      {ref.referredWallet.slice(-4)}
                    </td>
                    <td className="py-3 font-mono">{ref.referralCode}</td>
                    <td className="py-3 text-muted-foreground">
                      {new Date(ref.signedUpAt).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      {ref.hasTransacted ? (
                        <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-full px-2 py-1 text-xs font-medium">
                          Transacting
                        </span>
                      ) : (
                        <span className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded-full px-2 py-1 text-xs font-medium">
                          Onboarded
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
