"use client";

/**
 * Investment dashboard (#1018: investor scope on the buyer dashboard).
 *
 * Issue #1085: this component used to return early for `role === "buyer"`
 * *before* calling its hooks, so every hook below the branch was conditional.
 * Changing roles on a mounted instance would break hook order, and ESLint
 * flagged the whole component. It is now a pure role dispatcher: neither
 * branch has hooks of its own, and all investor state lives in
 * `InvestorDashboard`, whose hooks run on every render.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  fetchUserInvestments,
  claimableReturn,
  claimReturns,
  type InvestmentWithCampaign,
} from "@/services/investmentService";
import { formatAmount } from "@/services/campaignService";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useWalletNetworkGuard } from "@/hooks/useWalletNetworkGuard";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";

interface Props {
  investorAddress: string;
  role?: 'investor' | 'buyer';
}

export default function InvestmentDashboard({ investorAddress, role = 'investor' }: Props) {
  // Pure dispatcher, no hooks: mounting or unmounting a branch can never
  // change this component's own hook order (#1085).
  if (role === 'buyer') {
    return <BuyerDashboardPlaceholder />;
  }

  return <InvestorDashboard investorAddress={investorAddress} />;
}

/**
 * Buyer mode (#1018): a placeholder that deliberately mounts no investor
 * effects — no investment fetch, no WebSocket subscription.
 */
function BuyerDashboardPlaceholder() {
  return (
    <div className="bg-surface border border-border rounded-xl p-8 text-center text-muted text-sm">
      This is the Investment Dashboard. Buyer-specific dashboard features will be integrated here or in a separate component.
    </div>
  );
}

function InvestorDashboard({ investorAddress }: { investorAddress: string }) {
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  // Callback before the resource that runs it (#1084): stable per address and
  // abortable, so switching wallets mid-flight drops the stale response.
  const loadInvestments = useCallback(
    async (signal: AbortSignal) => {
      try {
        return await fetchUserInvestments(investorAddress);
      } catch (e) {
        if (signal.aborted) throw e;
        throw new Error(e instanceof Error ? e.message : "Failed to load investments");
      }
    },
    [investorAddress],
  );

  const {
    data,
    error,
    loading,
    reload,
  } = useAsyncResource(`investments:${investorAddress}`, loadInvestments);

  const investments = data ?? [];

  useWebSocket(
    useCallback(
      (msg: WsMessage) => {
        if (
          msg.type === "campaign.invested" ||
          msg.type === "campaign.settled" ||
          msg.type === "campaign.created"
        ) {
          setLastUpdate(msg.timestamp);
          reload();
        }
      },
      [reload],
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
      <div className="space-y-3" aria-label="Loading investments">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-5 animate-pulse h-24" aria-hidden="true" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-error rounded-xl p-5 text-error text-sm space-y-3" role="alert">
        <p>{error}</p>
        <button onClick={reload} className="underline hover:no-underline">Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
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
        <p className="text-xs text-muted" aria-live="polite">
          Live — last updated {new Date(lastUpdate).toLocaleTimeString()}
        </p>
      )}

      {investments.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-muted text-sm">
          No investments yet. Browse campaigns to get started.
        </div>
      ) : (
        <div className="space-y-3" aria-label="Investments list">
          {investments.map((inv) => (
            <InvestmentRow key={inv.id} investment={inv} onInvestmentUpdated={reload} />
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

function InvestmentRow({ investment, onInvestmentUpdated }: { investment: InvestmentWithCampaign; onInvestmentUpdated: () => void }) {
  const { campaign } = investment;
  const claimable = claimableReturn(investment);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  // Claiming settlement returns is a signed transaction (#1087): it is blocked
  // while the wallet network is wrong or unverifiable.
  const networkGuard = useWalletNetworkGuard();

  const statusColors: Record<string, string> = {
    FUNDING: "text-warning",
    FUNDED: "text-primary-600",
    IN_PRODUCTION: "text-primary-600",
    HARVESTED: "text-primary-600",
    SETTLED: "text-success",
    FAILED: "text-error",
    DISPUTED: "text-error",
  };

  const handleClaim = useCallback(async () => {
    if (!campaign.onChainId || campaign.onChainId === "pending" || claiming || claimed) return;
    if (networkGuard.blocked) {
      setClaimError(networkGuard.reason ?? "Wallet network does not match.");
      return;
    }

    setClaiming(true);
    setClaimError(null);
    try {
      const result = await claimReturns(
        investment.investorAddress,
        investment.campaignId,
        campaign.onChainId,
      );

      if (!result.success) {
        if (result.error?.includes("AlreadyClaimed")) {
          setClaimError("Already claimed");
        } else {
          setClaimError(result.error ?? "Failed to claim returns");
        }
      } else {
        setClaimed(true);
        onInvestmentUpdated();
      }
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "Failed to claim returns");
    } finally {
      setClaiming(false);
    }
  }, [campaign.onChainId, claiming, claimed, investment.investorAddress, investment.campaignId, networkGuard.blocked, networkGuard.reason, onInvestmentUpdated]);

  const canClaim = campaign.status === "SETTLED" && claimable > 0n && !claimed;

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

      <div className="flex items-center gap-2">
        <Link
          href={`/campaigns/${campaign.id}/messages`}
          className="whitespace-nowrap bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-medium hover:opacity-90 transition-opacity"
        >
          Message
        </Link>
        {canClaim && (
          <button
            onClick={handleClaim}
            disabled={claiming || networkGuard.blocked}
            aria-disabled={claiming || networkGuard.blocked}
            aria-describedby={networkGuard.blocked ? `claim-network-guard-${investment.id}` : undefined}
            aria-label={claiming ? "Claiming returns" : "Claim returns"}
            className="whitespace-nowrap bg-success text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {claiming ? "Claiming…" : "Claim"}
          </button>
        )}
        {canClaim && networkGuard.blocked && networkGuard.reason && (
          <p id={`claim-network-guard-${investment.id}`} className="text-xs text-error" role="alert">
            {networkGuard.reason}
          </p>
        )}
        {claimError && (
          <p className="text-xs text-error" role="alert">{claimError}</p>
        )}
        {claimed && (
          <p className="text-xs text-success font-medium">Claimed ✓</p>
        )}
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${
            statusColors[campaign.status] ?? "text-muted"
          }`}
        >
          {campaign.status.replace("_", " ")}
        </span>
      </div>
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
