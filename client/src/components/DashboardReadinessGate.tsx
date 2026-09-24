"use client";

/**
 * DashboardReadinessGate - Issue #1013
 *
 * Gates the My Dashboard (farmer portal) on the explicit wallet/auth/network
 * readiness state machine. A public shell is always rendered; private data and
 * mutating actions are only accessible when the full readiness chain is
 * satisfied:
 *   1. Wallet connected
 *   2. Correct network
 *   3. API authentication verified
 *
 * Each missing prerequisite renders a single, actionable recovery card.
 * Successful recovery navigates/re-renders without requiring a manual page
 * refresh.
 *
 * Security note: private keys, signed XDR, bearer/session tokens, and
 * sensitive wallet data must never appear in fixtures, logs, or screenshots.
 */

import { type ReactNode, useCallback, useState } from "react";
import {
  WifiOff,
  ShieldAlert,
  RadioTower,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";

interface DashboardReadinessGateProps {
  /** Content rendered only when the full readiness chain passes. */
  children: ReactNode;
  /**
   * Optional: external flag that the API/indexer backend is unavailable.
   * When true, an "API unavailable" recovery card is shown even if the wallet
   * and auth prerequisites are satisfied.
   */
  apiUnavailable?: boolean;
  /**
   * Optional: external flag that the indexer is still syncing after a
   * confirmed transaction. Shows a non-blocking banner rather than blocking
   * access to other data.
   */
  indexerSyncing?: boolean;
}

/** Shared visual shell for each recovery card. */
function RecoveryCard({
  icon: Icon,
  title,
  description,
  action,
  actionLabel,
  loading,
  id,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: () => void | Promise<void>;
  actionLabel?: string;
  loading?: boolean;
  id: string;
}) {
  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-muted">
        <Icon className="size-7 text-muted-foreground" aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>
      </div>
      {action && actionLabel && (
        <Button
          id={${id}-action}
          onClick={action}
          disabled={loading}
          className="gap-2"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
          {loading ? "Working…" : actionLabel}
        </Button>
      )}
    </div>
  );
}

export function DashboardReadinessGate({
  children,
  apiUnavailable = false,
  indexerSyncing = false,
}: DashboardReadinessGateProps) {
  const {
    connected,
    restoring,
    loading,
    networkMismatch,
    authenticated,
    authenticating,
    sessionError,
    connect,
    reauthenticate,
  } = useWallet();

  const [authLoading, setAuthLoading] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);

  const handleConnect = useCallback(async () => {
    setConnectLoading(true);
    try {
      await connect();
    } finally {
      setConnectLoading(false);
    }
  }, [connect]);

  const handleReauth = useCallback(async () => {
    setAuthLoading(true);
    try {
      await reauthenticate();
    } finally {
      setAuthLoading(false);
    }
  }, [reauthenticate]);

  // 1. Restoring session – show spinner, not an error card
  if (restoring || loading) {
    return (
      <div
        id="dashboard-gate-restoring"
        role="status"
        aria-live="polite"
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3"
      >
        <Loader2
          className="text-primary size-8 animate-spin"
          aria-hidden="true"
        />
        <p className="text-muted-foreground text-sm">Checking wallet…</p>
      </div>
    );
  }

  // 2. Not connected
  if (!connected) {
    return (
      <RecoveryCard
        id="dashboard-gate-not-connected"
        icon={WifiOff}
        title="Connect your wallet to continue"
        description="My Dashboard requires an active Stellar wallet connection. Connect to view private farm data and manage your crops."
        action={handleConnect}
        actionLabel="Connect Wallet"
        loading={connectLoading}
      />
    );
  }

  // 3. Wrong network
  if (networkMismatch) {
    return (
      <RecoveryCard
        id="dashboard-gate-wrong-network"
        icon={RadioTower}
        title="Switch to the correct network"
        description="Your wallet is connected to a different Stellar network than the one Agrocylo is configured for. Open your wallet and switch networks, then return here."
        actionLabel="I've switched – refresh"
        action={() => window.location.reload()}
      />
    );
  }

  // 4. API unavailable (backend / indexer down)
  if (apiUnavailable) {
    return (
      <RecoveryCard
        id="dashboard-gate-api-unavailable"
        icon={AlertTriangle}
        title="Service temporarily unavailable"
        description="Agrocylo's backend is currently unreachable. Your wallet is safe — please try again in a moment."
        action={() => window.location.reload()}
        actionLabel="Retry"
      />
    );
  }

  // 5. Authenticated session missing or expired
  if (!authenticated) {
    return (
      <RecoveryCard
        id="dashboard-gate-not-authenticated"
        icon={ShieldAlert}
        title={sessionError ? "Session expired – sign in again" : "Authenticate to access your dashboard"}
        description={
          sessionError
            ? "Your session has expired or the signature was declined. Sign the authentication request in your wallet to continue."
            : "Agrocylo needs you to sign a challenge with your connected wallet to verify ownership. No funds are moved."
        }
        action={handleReauth}
        actionLabel="Sign in with Wallet"
        loading={authLoading || authenticating}
      />
    );
  }

  // All prerequisites satisfied – render dashboard content.
  // Indexer-syncing is non-blocking: show a banner but do not gate access.
  return (
    <>
      {indexerSyncing && (
        <div
          id="dashboard-banner-indexer-syncing"
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300"
        >
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
          <span>
            Your recent transaction is confirmed — the indexer is still syncing.
            Data will refresh automatically.
          </span>
        </div>
      )}
      {children}
    </>
  );
}
