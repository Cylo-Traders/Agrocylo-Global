"use client";

import React from "react";
import { useWallet } from "../hooks/useWallet";

export default function WalletButton() {
  const { connected, connect, disconnect, loading } = useWallet();

  return (
    <div>
      {!connected ? (
        <button
          onClick={connect}
          disabled={loading}
          className="px-3 py-1 bg-green-600 text-sm rounded-md hover:bg-green-500 disabled:opacity-60"
        >
          {loading ? "Connecting..." : "Connect Wallet"}
        </button>
      ) : (
        <button
          onClick={disconnect}
          className="px-3 py-1 bg-red-600 text-sm rounded-md hover:bg-red-500"
        >
          Disconnect
        </button>
      )}
    </div>
  );
}
