"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCampaigns, fundingProgress, formatAmount } from "@/services/campaignService";
import type { Campaign, CampaignStatus } from "@/types";

const STATUS_COLORS: Record<CampaignStatus, string> = {
  FUNDING: "bg-blue-100 text-blue-700",
  FUNDED: "bg-primary-100 text-primary-700",
  IN_PRODUCTION: "bg-yellow-100 text-yellow-700",
  HARVESTED: "bg-green-100 text-green-700",
  SETTLED: "bg-neutral-100 text-neutral-700",
  FAILED: "bg-red-100 text-red-600",
  DISPUTED: "bg-orange-100 text-orange-700",
};

function FundingBar({ campaign }: { campaign: Campaign }) {
  const pct = fundingProgress(campaign);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted">
          {formatAmount(campaign.totalRaised)} XLM raised
        </span>
        <span className="font-medium text-foreground">{pct}%</span>
      </div>
      <div className="w-full bg-neutral-200 rounded-full h-2 overflow-hidden">
        <div
          className="bg-primary-500 h-2 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted mt-1">
        Goal: {formatAmount(campaign.targetAmount)} XLM
      </p>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const deadline = new Date(campaign.deadline);
  const isExpired = deadline < new Date();
  const daysLeft = Math.max(
    0,
    Math.ceil((deadline.getTime() - Date.now()) / 86_400_000),
  );

  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="block border border-border rounded-xl p-5 bg-surface hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-xs font-mono text-muted truncate">
            Farmer: {campaign.farmerAddress.slice(0, 8)}…{campaign.farmerAddress.slice(-6)}
          </p>
          <p className="text-xs text-muted mt-0.5">
            {campaign._count?.investments ?? 0} investors ·{" "}
            {campaign._count?.orders ?? 0} orders
          </p>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[campaign.status]}`}
        >
          {campaign.status.replace("_", " ")}
        </span>
      </div>

      <div className="mb-4">
        <FundingBar campaign={campaign} />
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {isExpired ? (
            <span className="text-error">Deadline passed</span>
          ) : (
            <span>{daysLeft}d left</span>
          )}
        </span>
        <span>{deadline.toLocaleDateString()}</span>
      </div>
    </Link>
  );
}

const STATUS_FILTERS: Array<{ label: string; value: string }> = [
  { label: "All", value: "" },
  { label: "Funding", value: "FUNDING" },
  { label: "Funded", value: "FUNDED" },
  { label: "In Production", value: "IN_PRODUCTION" },
  { label: "Harvested", value: "HARVESTED" },
  { label: "Settled", value: "SETTLED" },
];

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const limit = 12;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchCampaigns({ status: status || undefined, page, limit })
      .then((res) => {
        if (!cancelled) {
          setCampaigns(res.data);
          setTotal(res.meta.total);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load campaigns");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [status, page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Farming Campaigns</h1>
        <p className="text-muted mt-1">Invest in agricultural production and track progress on-chain.</p>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setStatus(f.value); setPage(1); }}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
              status === f.value
                ? "bg-primary-600 text-white border-primary-600"
                : "border-border text-muted hover:border-primary-400 hover:text-primary-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border border-border rounded-xl p-5 bg-surface animate-pulse h-36" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="border border-red-200 bg-red-50 rounded-xl p-6 text-red-700 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && campaigns.length === 0 && (
        <div className="border border-border rounded-xl p-10 text-center text-muted">
          No campaigns found.
        </div>
      )}

      {!loading && !error && campaigns.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-3 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-40 hover:bg-surface"
              >
                ← Previous
              </button>
              <span className="text-sm text-muted">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-40 hover:bg-surface"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
