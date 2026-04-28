"use client";

import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";

export default function NavBar() {
  return (
    <nav className="border-b border-border bg-surface sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <Link href="/home" className="font-bold text-lg text-primary-600 hover:text-primary-700">
          🌾 AgroProduction
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/marketplace" className="text-muted hover:text-foreground">Marketplace</Link>
          <Link href="/campaigns" className="text-muted hover:text-foreground">Campaigns</Link>
          <Link href="/orders" className="text-muted hover:text-foreground">Orders</Link>
          <Link href="/dashboard" className="text-muted hover:text-foreground">Dashboard</Link>
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}
