"use client";

import { useEffect, useState, useCallback } from "react";
import {
  fetchUserInvestments,
  claimableReturn,
  type InvestmentWithCampaign,
} from "@/services/investmentService";
import { formatAmount } from "@/services/campaignService";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";

interface Props {
  investorAddress: string;
}

export default function InvestmentDashboard({ investorAddress }: Props) {
  const [investments, setInvestments] = useState<InvestmentWithCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchUserInvestments(investorAddress);
      setInvestments(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load investments");
    } finally {
      setLoading(false);
    }
  }, [investorAddress]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates via WebSocket
  useWebSocket(
    useCallback(
      (msg: WsMessage) => {
        if (
          msg.event === "campaign.invested" ||
          msg.event === "campaign.settled" ||
          msg.event === "campaign.created"
        ) {
          setLastUpdate(msg.timestamp);
          load();
        }
      },
      [load],
    ),
  );

  const totalContributed = investments.reduce(
    (sum, inv) => sum + BigInt(inv.amount || "0"),
    0n,
  );

  const totalClaimable = investments.reduce(
    (sum, inv) => sum + claimableReturn(inv),
    0n,
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-5 animate-pulse h-24" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-error rounded-xl p-5 text-error text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard label="Total Invested" value={`${formatAmount(String(totalContributed))} XLM`} />
        <SummaryCard label="Campaigns" value={String(investments.length)} />
        <SummaryCard
          label="Claimable Returns"
          value={`${formatAmount(String(totalClaimable))} XLM`}
          highlight={totalClaimable > 0n}
        />
      </div>

      {lastUpdate && (
        <p className="text-xs text-muted">
          Live — last updated {new Date(lastUpdate).toLocaleTimeString()}
        </p>
      )}

      {investments.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-muted text-sm">
          No investments yet. Browse campaigns to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {investments.map((inv) => (
            <InvestmentRow key={inv.id} investment={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-surface border rounded-xl p-5 ${
        highlight ? "border-primary-500" : "border-border"
      }`}
    >
      <p className="text-xs text-muted mb-1">{label}</p>
      <p
        className={`text-lg font-semibold ${
          highlight ? "text-primary-600" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function InvestmentRow({ investment }: { investment: InvestmentWithCampaign }) {
  const { campaign } = investment;
  const claimable = claimableReturn(investment);
  const statusColors: Record<string, string> = {
    FUNDING: "text-warning",
    FUNDED: "text-primary-600",
    IN_PRODUCTION: "text-primary-600",
    HARVESTED: "text-primary-600",
    SETTLED: "text-success",
    FAILED: "text-error",
    DISPUTED: "text-error",
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted font-mono truncate">
          Campaign {campaign.onChainId}
        </p>
        <p className="text-sm text-muted font-mono truncate">
          Farmer: {campaign.farmerAddress.slice(0, 8)}…{campaign.farmerAddress.slice(-4)}
        </p>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="Contributed" value={`${formatAmount(investment.amount)} XLM`} />
        <Stat
          label="Campaign raised"
          value={`${formatAmount(campaign.totalRaised)} / ${formatAmount(campaign.targetAmount)} XLM`}
        />
        {claimable > 0n && (
          <Stat
            label="Claimable"
            value={`${formatAmount(String(claimable))} XLM`}
            highlight
          />
        )}
      </div>

      <span
        className={`text-xs font-semibold uppercase tracking-wide ${
          statusColors[campaign.status] ?? "text-muted"
        }`}
      >
        {campaign.status.replace("_", " ")}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`font-medium ${highlight ? "text-primary-600" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}
