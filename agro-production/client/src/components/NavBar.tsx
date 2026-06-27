"use client";

import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { useTheme } from "@/context/ThemeContext";

const MAIN_CLIENT_URL = process.env.NEXT_PUBLIC_MAIN_CLIENT_URL ?? "http://localhost:3000";

export default function NavBar() {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <nav className="border-b border-border bg-surface sticky top-0 z-10" aria-label="Main navigation">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/home" className="font-bold text-lg text-primary-600 hover:text-primary-700" aria-label="AgroProduction home">
            🌾 AgroProduction
          </Link>
          <a
            href={MAIN_CLIENT_URL}
            className="text-xs text-muted hover:text-foreground border border-border px-2 py-1 rounded transition-colors"
            aria-label="Back to Agrocylo main app"
          >
            ← Back to Agrocylo
          </a>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/marketplace" className="text-muted hover:text-foreground" aria-label="Browse marketplace">Marketplace</Link>
          <Link href="/campaigns" className="text-muted hover:text-foreground" aria-label="View campaigns">Campaigns</Link>
          <Link href="/orders" className="text-muted hover:text-foreground" aria-label="View orders">Orders</Link>
          <Link href="/farmer-dashboard" className="text-muted hover:text-foreground" aria-label="Open farmer dashboard">Farmer</Link>
          <Link href="/dashboard" className="text-muted hover:text-foreground" aria-label="View dashboard">Dashboard</Link>
          <button
            onClick={toggleTheme}
            className="text-muted hover:text-foreground border border-border px-2.5 py-1.5 rounded-lg text-sm transition-colors"
            aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
          >
            {resolvedTheme === "dark" ? "☀️" : "🌙"}
          </button>
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}
