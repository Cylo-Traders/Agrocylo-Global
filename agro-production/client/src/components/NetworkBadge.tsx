"use client";

/**
 * Compact testnet / mainnet badge for the shared shell (#1087).
 *
 * Renders nothing while no wallet is connected. Once one is, it always shows
 * something — including the uncomfortable states: a red badge for a known
 * wrong network, an amber one when the wallet cannot report its network at
 * all. Hiding the badge in those states is exactly the failure mode this
 * component exists to prevent.
 */

import { useWallet } from "@/context/WalletContext";
import { networkName } from "@/lib/stellarNetwork";

const STYLES: Record<"match" | "mismatch" | "unknown" | "checking", string> = {
  match: "border-green-300 bg-green-50 text-green-700",
  mismatch: "border-red-300 bg-red-50 text-red-700",
  unknown: "border-amber-300 bg-amber-50 text-amber-700",
  checking: "border-border bg-surface text-muted",
};

const LABELS: Record<"match" | "mismatch" | "unknown" | "checking", string> = {
  match: "Wallet network",
  mismatch: "Wrong network",
  unknown: "Network unknown",
  checking: "Checking network",
};

export function NetworkBadge({ className = "" }: { className?: string }) {
  const { connected, networkStatus, networkPassphrase } = useWallet();

  if (!connected) return null;

  const tone = (
    networkStatus === "mismatch" || networkStatus === "unknown"
      ? networkStatus
      : networkStatus === "match"
        ? "match"
        : "checking"
  ) as "match" | "mismatch" | "unknown" | "checking";

  const current = networkName(networkPassphrase);

  return (
    <span
      data-testid="network-badge"
      data-network-tone={tone}
      title={
        networkStatus === "checking"
          ? "Asking the wallet which network it is on…"
          : `Wallet network: ${current}`
      }
      aria-label={`${LABELS[tone]}: ${current}`}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-1 rounded-lg text-xs font-medium ${STYLES[tone]} ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {networkStatus === "checking" ? "…" : current}
    </span>
  );
}

export default NetworkBadge;
