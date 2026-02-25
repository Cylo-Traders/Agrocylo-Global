"use client";

import React from "react";
import WalletButton from "./WalletButton";
import WalletDisplay from "./WalletDisplay";

export default function Navbar() {
  return (
    <nav className="w-full flex items-center justify-between px-6 py-3 bg-gray-900 text-white">
      <div className="flex items-center gap-3">
        <div className="text-2xl font-bold">AgroCylo 🌾</div>
      </div>
      <div className="flex items-center gap-6">
        <WalletDisplay />
        <WalletButton />
      </div>
    </nav>
  );
}
