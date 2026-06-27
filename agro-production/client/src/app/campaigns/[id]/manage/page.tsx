"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchCampaign, fundingProgress, formatAmount } from "@/services/campaignService";
import { trackCampaignViewed } from "@/lib/analytics";
import { classifyError, logErrorWithContext } from "@/lib/errorHandling";
import { CampaignDetailSkeleton } from "@/components/Skeletons";
import InvestmentModal from "@/components/ui/InvestmentModal";
import { useWallet } from "@/context/WalletContext";
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
  const [investmentOpen, setInvestmentOpen] = useState(false);
  const { address, connected, connect, loading: walletLoading } = useWallet();

  const loadCampaign = useCallback(async () => {
    if (!id) return;
    try {
      const loadedCampaign = await fetchCampaign(id);
      setCampaign(loadedCampaign);
      setError(null);
      trackCampaignViewed(id);
    } catch (err: unknown) {
      const classified = classifyError(err, "loadCampaign");
      logErrorWithContext(err, {
        feature: "campaign-detail",
        action: "loadCampaign",
        campaignId: id,
        category: classified.category,
      });
      setError(classified.actionableMessage);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);

  const refreshCampaign = useCallback(() => {
    void loadCampaign();
  }, [loadCampaign]);

  if (loading) return <CampaignDetailSkeleton />;

  if (error) return (<div className="border border-red-200 bg-red-50 rounded-xl p-6 text-red-700 text-sm" role="alert">{error}</div>);
  if (!campaign) return null;

  const pct = fundingProgress(campaign);
  const deadline = new Date(campaign.deadline);
  const createdAt = new Date(campaign.createdAt);
  const isExpired = deadline < new Date();
  const daysLeft = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86_400_000));
  const canOrder = campaign.status === "HARVESTED" || campaign.status === "IN_PRODUCTION";
  const canInvest = campaign.status === "FUNDING" && !isExpired && campaign.onChainId !== "pending";

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb">
        <Link href="/campaigns" className="text-sm text-muted hover:text-foreground">← Back to Campaigns</Link>
      </nav>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campaign Detail</h1>
          <p className="text-sm font-mono text-muted mt-1 break-all">ID: {campaign.id}</p>
        </div>
        <span className="text-sm font-medium px-3 py-1 rounded-full bg-primary-50 text-primary-700 border border-primary-200">{campaign.status.replace("_", " ")}</span>
      </div>
      <section aria-label="Farmer information" className="border border-border rounded-xl p-5 bg-surface">
        <h2 className="text-base font-semibold text-foreground mb-3">Farmer Info</h2>
        <div className="space-y-2 text-sm">
          <div><span className="text-muted">Wallet Address</span><p className="font-mono text-foreground break-all mt-0.5">{campaign.farmerAddress}</p></div>
          <div><span className="text-muted">Token Contract</span><p className="font-mono text-foreground break-all mt-0.5">{campaign.tokenAddress}</p></div>
        </div>
      </section>
      <section aria-label="Funding statistics">
        <h2 className="text-base font-semibold text-foreground mb-3">Funding Stats</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total Raised" value={`${formatAmount(campaign.totalRaised)} XLM`} />
          <StatCard label="Goal" value={`${formatAmount(campaign.targetAmount)} XLM`} />
          <StatCard label="Investors" value={String(campaign.investments.length)} />
          <StatCard label="Orders" value={String(campaign.orders.length)} />
        </div>
        <div className="border border-border rounded-xl p-4 bg-surface">
          <div className="flex justify-between text-sm mb-2"><span className="text-muted">Funding progress</span><span className="font-semibold text-foreground">{pct}%</span></div>
          <div className="w-full bg-neutral-200 rounded-full h-3 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% funded`}>
            <div className="bg-primary-500 h-3 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </section>
      <section aria-label="Timeline">
        <h2 className="text-base font-semibold text-foreground mb-3">Timeline</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-border rounded-xl p-4 bg-surface text-sm"><p className="text-muted mb-1">Campaign Created</p><p className="font-medium text-foreground">{createdAt.toLocaleDateString()}</p><p className="text-muted text-xs">{createdAt.toLocaleTimeString()}</p></div>
          <div className="border border-border rounded-xl p-4 bg-surface text-sm"><p className="text-muted mb-1">Deadline</p><p className={`font-medium ${isExpired ? "text-error" : "text-foreground"}`}>{deadline.toLocaleDateString()}</p><p className={`text-xs ${isExpired ? "text-error" : "text-muted"}`}>{isExpired ? "Deadline passed" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining`}</p></div>
        </div>
      </section>
      {campaign.investments.length > 0 && (
        <section aria-label="Investments list">
          <h2 className="text-base font-semibold text-foreground mb-3">Investments ({campaign.investments.length})</h2>
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <caption className="sr-only">Investments in this campaign</caption>
              <thead className="bg-surface border-b border-border">
                <tr><th scope="col" className="text-left px-4 py-2 text-muted font-medium">Investor</th><th scope="col" className="text-right px-4 py-2 text-muted font-medium">Amount</th><th scope="col" className="text-right px-4 py-2 text-muted font-medium">Date</th></tr>
              </thead>
              <tbody>
                {campaign.investments.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-surface">
                    <td className="px-4 py-2 font-mono text-xs text-muted">{inv.investorAddress.slice(0, 8)}…{inv.investorAddress.slice(-6)}</td>
                    <td className="px-4 py-2 text-right font-medium text-foreground">{formatAmount(inv.amount)} XLM</td>
                    <td className="px-4 py-2 text-right text-muted">{new Date(inv.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {canInvest && (
        <section className="border border-primary-200 bg-primary-50 rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-primary-800">Fund this campaign</p>
            <p className="text-sm text-primary-700 mt-0.5">Invest with your connected wallet. Your contribution appears after on-chain confirmation and indexing.</p>
          </div>
          {!connected ? (
            <button
              onClick={connect}
              disabled={walletLoading}
              className="whitespace-nowrap bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {walletLoading ? "Connecting…" : "Connect Wallet"}
            </button>
          ) : (
            <button
              onClick={() => setInvestmentOpen(true)}
              className="whitespace-nowrap bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700"
              aria-label={`Invest in campaign ${campaign.id.slice(0, 8)}…`}
            >
              Invest
            </button>
          )}
        </section>
      )}
      {canOrder && (
        <div className="border border-primary-200 bg-primary-50 rounded-xl p-5 flex items-center justify-between gap-4">
          <div><p className="font-semibold text-primary-800">Ready to Order</p><p className="text-sm text-primary-700 mt-0.5">This campaign is accepting orders. Place a secure escrow order.</p></div>
          <Link href={`/checkout/${campaign.id}`} className="whitespace-nowrap bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700" aria-label={`Place order for campaign ${campaign.id.slice(0, 8)}…`}>Place Order</Link>
        </div>
      )}
      {address && (
        <InvestmentModal
          open={investmentOpen}
          onClose={() => setInvestmentOpen(false)}
          campaignId={campaign.id}
          onChainCampaignId={campaign.onChainId}
          investorAddress={address}
          onIndexed={refreshCampaign}
        />
      )}
    </div>
  );
}
