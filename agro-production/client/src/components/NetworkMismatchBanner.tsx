"use client";

/**
 * Persistent, page-level banner shown while the connected wallet's network
 * does not match the network this app is configured for — or cannot be
 * verified at all (#1087).
 *
 * This is deliberately an always-visible banner (not a toast): while it is
 * showing, financial actions are refused by `useWalletNetworkGuard` in the UI
 * and by `lib/signTransaction` at the signing layer, so invest / order /
 * settlement / claim cannot proceed until the wallet network is right.
 *
 * It mirrors the banner the main Agrocylo client already ships, so the two
 * apps behave identically when a wallet is pointed at the wrong network.
 */

import { useWallet } from "@/context/WalletContext";
import { networkName } from "@/lib/stellarNetwork";

export function NetworkMismatchBanner() {
  const {
    connected,
    networkStatus,
    networkPassphrase,
    expectedNetworkPassphrase,
  } = useWallet();

  if (!connected) return null;
  if (networkStatus !== "mismatch" && networkStatus !== "unknown") return null;

  const expectedName = networkName(expectedNetworkPassphrase);

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="network-mismatch-banner"
      className="w-full border-b border-red-700 bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white"
    >
      {networkStatus === "mismatch" ? (
        <span>
          ⚠️ Wrong wallet network. Your wallet is on{" "}
          <strong>{networkName(networkPassphrase)}</strong> but this app runs on{" "}
          <strong>{expectedName}</strong>. Switch your wallet&apos;s network to{" "}
          {expectedName} to continue — investing, ordering and claiming are
          blocked until it matches.
        </span>
      ) : (
        <span>
          ⚠️ Wallet network unknown. Your wallet did not report which network it
          is on, so this app cannot confirm it matches <strong>{expectedName}</strong>{" "}
          — investing, ordering and claiming are blocked until it can.
        </span>
      )}
    </div>
  );
}

export default NetworkMismatchBanner;
