"use client";

import React from "react";
import Link from "next/link";
import WalletButton from "./WalletButton";
import WalletDisplay from "./WalletDisplay";

export default function Navbar() {
  return (
    <nav className="w-full flex items-center justify-between px-6 py-3 bg-gray-900 text-white">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-2xl font-bold hover:opacity-90">
          AgroCylo 🌾
        </Link>
        <div className="hidden sm:flex items-center gap-4 text-sm">
          <Link href="/map" className="hover:text-primary-400 transition-colors">
            Farmer Map
          </Link>
          <Link href="/orders" className="hover:text-primary-400 transition-colors">
            Orders
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <WalletDisplay />
        <WalletButton />
      </div>
    </nav>
  );
}
