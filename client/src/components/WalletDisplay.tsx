"use client";

import React from "react";
import { useWallet } from "../hooks/useWallet";

function shortAddr(addr: string | null) {
  if (!addr) return "-";
  return addr.slice(0, 6) + "..." + addr.slice(-6);
}

export default function WalletDisplay() {
  const { address, balance, connected, error, network } = useWallet();

  const getNetworkDisplay = (net: string | null): string => {
    if (!net) return "-";
    const lower = net.toLowerCase();
    if (lower.includes("public")) return "Mainnet";
    if (lower.includes("test")) return "Testnet";
    return net;
  };

  return (
    <div className="flex flex-col items-start gap-2" role="region" aria-label="Wallet information">
      <div className="flex items-center gap-6">
        <div className="text-sm text-gray-300">
          <div>Address</div>
          <div className="font-mono" aria-label={`Wallet address: ${connected ? shortAddr(address) : "Not connected"}`}>
            {connected ? shortAddr(address) : "Not connected"}
          </div>
        </div>
        <div className="text-sm text-gray-300">
          <div>Balance</div>
          <div className="font-mono" aria-label={`Balance: ${connected ? (balance ?? "-") + " XLM" : "Not available"}`}>
            {connected ? (balance ?? "-") + " XLM" : "-"}
          </div>
        </div>
        <div className="text-sm text-gray-300">
          <div>Network</div>
          <div className="font-mono" aria-label={`Network: ${getNetworkDisplay(network)}`}>{getNetworkDisplay(network)}</div>
        </div>
      </div>
      {error && (
        <div className="text-xs text-red-400 max-w-sm" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
}
