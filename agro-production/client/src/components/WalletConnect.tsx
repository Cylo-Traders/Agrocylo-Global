"use client";

import { useWallet } from "@/context/WalletContext";

function shortAddr(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

interface WalletConnectProps {
  className?: string;
}

export default function WalletConnect({ className = "" }: WalletConnectProps) {
  const { address, connected, loading, error, connect, disconnect } = useWallet();

  if (connected && address) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span
          className="font-mono text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1.5 rounded-lg"
          title={address}
        >
          {shortAddr(address)}
        </span>
        <button
          onClick={disconnect}
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
        onClick={connect}
        disabled={loading}
        className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Connecting…" : "Connect Wallet"}
      </button>
      {error && (
        <p className="text-xs text-red-600 max-w-xs">{error}</p>
      )}
    </div>
  );
}
