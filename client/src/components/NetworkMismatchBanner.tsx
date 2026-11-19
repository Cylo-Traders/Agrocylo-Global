"use client";

/**
 * Page-level banner shown when the connected wallet's active network does not
 * match the network this app is configured for.
 *
 * Signing and submission are still refused by `WalletContext.signAndSubmit`
 * and `lib/stellarTransactions` regardless of banner visibility, so checkout
 * and escrow actions remain blocked even after the user dismisses the banner.
 *
 * The banner auto-reappears whenever the wallet network changes (e.g. user
 * switches networks in their extension), so dismissing it is always safe.
 */

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  getStellarEnv,
  normalizeToPassphrase,
  MAINNET_PASSPHRASE,
} from "@/services/stellar/networkConfig";

function friendlyName(passphrase: string | null): string {
  if (!passphrase) return "an unknown network";
  if (passphrase === MAINNET_PASSPHRASE) return "Mainnet";
  return passphrase === "Test SDF Network ; September 2015"
    ? "Testnet"
    : passphrase;
}

export function NetworkMismatchBanner() {
  const { networkMismatch, network } = useWallet();
  const [dismissed, setDismissed] = useState(false);

  // Re-show the banner whenever the network changes so a new mismatch is
  // always surfaced even if the user had previously dismissed the banner.
  useEffect(() => {
    setDismissed(false);
  }, [network]);

  if (!networkMismatch || dismissed) return null;

  const expectedEnv = getStellarEnv();
  const walletName = friendlyName(normalizeToPassphrase(network));

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-[60] w-full border-b border-yellow-600 bg-yellow-500 px-4 py-2 text-center text-sm font-semibold text-yellow-950"
    >
      <span className="inline-flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        Wrong wallet network. Your wallet is on{" "}
        <strong>{walletName}</strong> but this app runs on{" "}
        <strong>{expectedEnv === "mainnet" ? "Mainnet" : "Testnet"}</strong>.
        Switch your wallet&apos;s network — checkout and escrow actions are
        blocked until it matches.
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss network mismatch warning"
          className="ml-2 rounded p-0.5 hover:bg-yellow-600/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-800"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

export default NetworkMismatchBanner;
