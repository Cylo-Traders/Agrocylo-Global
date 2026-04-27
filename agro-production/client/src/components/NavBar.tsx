"use client";

import Link from "next/link";
import { useWallet } from "@/context/WalletContext";

function shortAddr(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function NavBar() {
  const { address, connected, loading, connect, disconnect } = useWallet();

  return (
    <nav className="border-b border-border bg-surface sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <Link href="/campaigns" className="font-bold text-lg text-primary-600 hover:text-primary-700">
          🌾 AgroProduction
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/campaigns" className="text-muted hover:text-foreground">Campaigns</Link>
          <Link href="/orders" className="text-muted hover:text-foreground">Orders</Link>
          {connected && address ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs bg-primary-50 text-primary-700 px-2 py-1 rounded">
                {shortAddr(address)}
              </span>
              <button
                onClick={disconnect}
                className="text-muted hover:text-foreground"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={loading}
              className="bg-primary-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
