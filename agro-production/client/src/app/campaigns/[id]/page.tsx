"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchCampaign, fundingProgress, formatAmount } from "@/services/campaignService";
import type { CampaignDetail } from "@/types";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-xl p-4 bg-surface">
      <p className="text-xs text-muted mb-1">{label}</p>
      <p className="text-lg font-semibold text-foreground truncate">{value}</p>
    </div>
  );
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchCampaign(id)
      .then(setCampaign)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load campaign"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-neutral-200 rounded" />
        <div className="h-32 bg-neutral-200 rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-neutral-200 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-xl p-6 text-red-700 text-sm">
        {error}
      </div>
    );
  }

  if (!campaign) return null;

  const pct = fundingProgress(campaign);
  const deadline = new Date(campaign.deadline);
  const createdAt = new Date(campaign.createdAt);
  const isExpired = deadline < new Date();
  const daysLeft = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86_400_000));
  const canOrder = campaign.status === "HARVESTED" || campaign.status === "IN_PRODUCTION";

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/campaigns" className="text-sm text-muted hover:text-foreground">
        ← Back to Campaigns
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campaign Detail</h1>
          <p className="text-sm font-mono text-muted mt-1 break-all">ID: {campaign.id}</p>
        </div>
        <span className="text-sm font-medium px-3 py-1 rounded-full bg-primary-50 text-primary-700 border border-primary-200">
          {campaign.status.replace("_", " ")}
        </span>
      </div>

      {/* Farmer Info */}
      <div className="border border-border rounded-xl p-5 bg-surface">
        <h2 className="text-base font-semibold text-foreground mb-3">Farmer Info</h2>
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-muted">Wallet Address</span>
            <p className="font-mono text-foreground break-all mt-0.5">{campaign.farmerAddress}</p>
          </div>
          <div>
            <span className="text-muted">Token Contract</span>
            <p className="font-mono text-foreground break-all mt-0.5">{campaign.tokenAddress}</p>
          </div>
        </div>
      </div>

      {/* Funding Stats */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-3">Funding Stats</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total Raised" value={`${formatAmount(campaign.totalRaised)} XLM`} />
          <StatCard label="Goal" value={`${formatAmount(campaign.targetAmount)} XLM`} />
          <StatCard label="Investors" value={String(campaign.investments.length)} />
          <StatCard label="Orders" value={String(campaign.orders.length)} />
        </div>

        {/* Progress bar */}
        <div className="border border-border rounded-xl p-4 bg-surface">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted">Funding progress</span>
            <span className="font-semibold text-foreground">{pct}%</span>
          </div>
          <div className="w-full bg-neutral-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-primary-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-3">Timeline</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-border rounded-xl p-4 bg-surface text-sm">
            <p className="text-muted mb-1">Campaign Created</p>
            <p className="font-medium text-foreground">{createdAt.toLocaleDateString()}</p>
            <p className="text-muted text-xs">{createdAt.toLocaleTimeString()}</p>
          </div>
          <div className="border border-border rounded-xl p-4 bg-surface text-sm">
            <p className="text-muted mb-1">Deadline</p>
            <p className={`font-medium ${isExpired ? "text-error" : "text-foreground"}`}>
              {deadline.toLocaleDateString()}
            </p>
            <p className={`text-xs ${isExpired ? "text-error" : "text-muted"}`}>
              {isExpired ? "Deadline passed" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining`}
            </p>
          </div>
        </div>
      </div>

      {/* Investments */}
      {campaign.investments.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Investments ({campaign.investments.length})
          </h2>
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 text-muted font-medium">Investor</th>
                  <th className="text-right px-4 py-2 text-muted font-medium">Amount</th>
                  <th className="text-right px-4 py-2 text-muted font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {campaign.investments.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-surface">
                    <td className="px-4 py-2 font-mono text-xs text-muted">
                      {inv.investorAddress.slice(0, 8)}…{inv.investorAddress.slice(-6)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-foreground">
                      {formatAmount(inv.amount)} XLM
                    </td>
                    <td className="px-4 py-2 text-right text-muted">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Place order CTA */}
      {canOrder && (
        <div className="border border-primary-200 bg-primary-50 rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-primary-800">Ready to Order</p>
            <p className="text-sm text-primary-700 mt-0.5">
              This campaign is accepting orders. Place a secure escrow order.
            </p>
          </div>
          <Link
            href={`/checkout/${campaign.id}`}
            className="whitespace-nowrap bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700"
          >
            Place Order
          </Link>
        </div>
      )}
    </div>
  );
}
