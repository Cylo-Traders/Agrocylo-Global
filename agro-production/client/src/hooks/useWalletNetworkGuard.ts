"use client";

/**
 * Single source of truth for "may the user start a financial action right
 * now?" (#1087).
 *
 * Investment, order, settlement and claim actions all consume this hook so
 * the blocking rule — and the sentence that explains it — is written once
 * instead of being re-derived per screen.
 */

import { useWallet } from "@/context/WalletContext";
import { networkName } from "@/lib/stellarNetwork";

export interface WalletNetworkGuard {
  /** True when a financial action must not start (mismatch or unknown network). */
  blocked: boolean;
  /** One-sentence explanation to render next to the disabled control. */
  reason: string | null;
  /** e.g. "Testnet" — for badges and copy. */
  expectedNetworkName: string;
  /** What the wallet reports, or null when it cannot be verified. */
  walletNetworkName: string | null;
}

export function useWalletNetworkGuard(): WalletNetworkGuard {
  const {
    connected,
    networkStatus,
    networkPassphrase,
    expectedNetworkPassphrase,
  } = useWallet();

  const expectedNetworkName = networkName(expectedNetworkPassphrase);
  const walletNetworkName = networkPassphrase
    ? networkName(networkPassphrase)
    : null;

  if (!connected) {
    return { blocked: false, reason: null, expectedNetworkName, walletNetworkName: null };
  }

  if (networkStatus === "mismatch") {
    return {
      blocked: true,
      reason: `Your wallet is on ${walletNetworkName}, but this app runs on ${expectedNetworkName}. Switch your wallet's network to ${expectedNetworkName} to continue.`,
      expectedNetworkName,
      walletNetworkName,
    };
  }

  if (networkStatus === "unknown") {
    return {
      blocked: true,
      reason: `Your wallet did not report which network it is on. Transactions are blocked until the wallet is set to ${expectedNetworkName}.`,
      expectedNetworkName,
      walletNetworkName: null,
    };
  }

  return { blocked: false, reason: null, expectedNetworkName, walletNetworkName };
}

export default useWalletNetworkGuard;
