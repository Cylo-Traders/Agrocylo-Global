"use client";

import React from "react";
import WalletButton from "./WalletButton";
import WalletDisplay from "./WalletDisplay";
import { useCart } from "@/context/CartContext";

export default function Navbar() {
  const { itemCount, setDrawerOpen } = useCart();
  return (
    <nav className="w-full flex items-center justify-between px-6 py-3 bg-gray-900 text-white">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-2xl font-bold hover:opacity-90">
          AgroCylo 🌾
        </Link>
        <div className="hidden sm:flex items-center gap-4 text-sm">
          <Link
            href="/map"
            className="hover:text-primary-400 transition-colors"
          >
            Farmer Map
          </Link>
          <Link
            href="/orders"
            className="hover:text-primary-400 transition-colors"
          >
            Orders
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4">
          <Link href="/market" className="text-sm hover:opacity-80">
            Market
          </Link>
          <Link href="/dashboard" className="text-sm hover:opacity-80">
            Farmer Dashboard
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="relative inline-flex items-center justify-center px-3 py-1 rounded-md border border-white/20 hover:bg-white/10"
          aria-label="Open cart"
        >
          <span className="text-sm">Cart</span>
          {itemCount > 0 && (
            <span className="absolute -top-2 -right-2 min-w-6 h-6 px-1 rounded-full bg-green-500 text-xs font-bold flex items-center justify-center">
              {itemCount}
            </span>
          )}
        </button>
        <WalletDisplay />
        <WalletButton />
      </div>
    </nav>
  );
}
