"use client";

import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import WalletConnect from "@/components/WalletConnect";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function DashboardPage() {
  const { address, connected } = useWallet();

  if (!connected || !address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">My Dashboard</h1>
          <p className="text-muted">Connect your wallet to view your activity.</p>
        </div>
        <WalletConnect />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">My Dashboard</h1>
        <WalletConnect />
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="text-sm text-muted mb-1">Connected address</p>
        <p className="font-mono text-sm text-foreground break-all">{address}</p>
        <p className="font-mono text-xs text-muted mt-1">({shortAddr(address)})</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/orders"
          className="bg-surface border border-border rounded-xl p-5 hover:border-primary-400 transition-colors block"
        >
          <h2 className="font-semibold text-foreground mb-1">My Orders</h2>
          <p className="text-sm text-muted">View your purchase history and order status.</p>
        </Link>
        <Link
          href="/campaigns"
          className="bg-surface border border-border rounded-xl p-5 hover:border-primary-400 transition-colors block"
        >
          <h2 className="font-semibold text-foreground mb-1">Browse Campaigns</h2>
          <p className="text-sm text-muted">Discover and fund active agricultural campaigns.</p>
        </Link>
        <Link
          href="/marketplace"
          className="bg-surface border border-border rounded-xl p-5 hover:border-primary-400 transition-colors block"
        >
          <h2 className="font-semibold text-foreground mb-1">Marketplace</h2>
          <p className="text-sm text-muted">Browse available produce and farm products.</p>
        </Link>
      </div>
    </div>
  );
}
