"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { trackWalletConnected, trackWalletDisconnected } from "@/lib/analytics";

function shortAddr(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

interface WalletConnectProps {
  className?: string;
}

export default function WalletConnect({ className = "" }: WalletConnectProps) {
  const {
    address,
    loading,
    reconnecting,
    error,
    walletState,
    walletId,
    wallets,
    connect,
    disconnect,
    selectWallet,
  } = useWallet();
  const busy = loading || reconnecting;
  const [showWalletList, setShowWalletList] = useState(false);
  const activeWallet = wallets.find((wallet) => wallet.id === walletId);

  async function handleConnect(id?: string) {
    if (id) selectWallet(id);
    setShowWalletList(false);
    const addr = await connect(id);
    if (addr) trackWalletConnected(addr);
  }

  async function handleDisconnect() {
    trackWalletDisconnected();
    await disconnect();
  }

  if (walletState === "connected" && address) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span
          className="font-mono text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1.5 rounded-lg"
          title={address}
          aria-label={`Connected wallet: ${address}`}
        >
          {shortAddr(address)}
        </span>
        <button
          onClick={() => void handleDisconnect()}
          aria-label="Disconnect wallet"
          className="text-sm text-muted hover:text-foreground border border-border px-2.5 py-1.5 rounded-lg transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-start gap-1 ${className}`}>
      <button
        onClick={() => void handleConnect()}
        disabled={busy}
        aria-label={busy ? "Connecting wallet" : "Connect wallet"}
        className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
      >
        {reconnecting
          ? "Reconnecting…"
          : loading
            ? "Connecting…"
            : "Connect Wallet"}
      </button>

      {wallets.length > 0 && !busy && (
        <div className="relative">
          <button
            onClick={() => setShowWalletList((visible) => !visible)}
            aria-expanded={showWalletList}
            aria-haspopup="menu"
            className="text-xs text-muted hover:text-foreground underline"
          >
            Choose a wallet
          </button>
          {showWalletList && (
            <ul
              role="menu"
              aria-label="Stellar wallets"
              className="absolute z-10 mt-1 bg-white border border-border rounded-lg shadow-sm py-1 min-w-[15rem] max-h-80 overflow-y-auto"
            >
              {wallets.map((wallet) => (
                <li key={wallet.id} role="none">
                  {wallet.available === false ? (
                    <a
                      role="menuitem"
                      href={wallet.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Install or open ${wallet.name}`}
                      className="w-full px-3 py-2 text-sm hover:bg-primary-50 flex items-center justify-between gap-3"
                    >
                      <span>{wallet.name}</span>
                      <span className="text-xs text-muted">
                        {wallet.supportsDeepLink ? "Open / install" : "Install"}
                      </span>
                    </a>
                  ) : (
                    <button
                      role="menuitem"
                      onClick={() => void handleConnect(wallet.id)}
                      aria-label={`Connect ${wallet.name}`}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 flex items-center justify-between gap-3"
                    >
                      <span>{wallet.name}</span>
                      <span className="text-xs text-muted">
                        {wallet.available === null
                          ? "Checking…"
                          : wallet.platforms.join(" · ")}
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {walletState === "unavailable" && activeWallet && (
        <p className="text-xs text-red-600 max-w-xs" role="alert">
          {activeWallet.name} is unavailable in this browser.{" "}
          <a
            href={activeWallet.installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-red-700"
          >
            {activeWallet.supportsDeepLink ? "Open or install it" : "Install it"}
          </a>
          , then try again.
        </p>
      )}

      {error && walletState !== "unavailable" && (
        <p className="text-xs text-red-600 max-w-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
