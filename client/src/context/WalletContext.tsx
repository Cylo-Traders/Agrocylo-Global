"use client";

import React, { createContext, useEffect, useState } from "react";
import type { WalletContextType } from "../types/wallet";
import { getXlmBalance, getCurrentNetworkName } from "../lib/stellar";
import FreighterApi from "@stellar/freighter-api";

const initialState: WalletContextType = {
  address: null,
  balance: null,
  connected: false,
  loading: false,
  error: null,
  network: null,
  connect: async () => {},
  disconnect: () => {},
  refreshBalance: async () => {},
};

export const WalletContext = createContext<WalletContextType>(initialState);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);

  useEffect(() => {
    // Try to restore from localStorage
    const addr =
      typeof window !== "undefined"
        ? localStorage.getItem("walletAddress")
        : null;
    const net =
      typeof window !== "undefined"
        ? localStorage.getItem("walletNetwork")
        : null;
    if (addr) {
      // attempt to refresh balance but don't auto-connect Freighter
      setAddress(addr);
      setConnected(true);
      if (net) setNetwork(net);
      // call getXlmBalance directly to avoid referencing refreshBalance in deps
      (async () => {
        try {
          const b = await getXlmBalance(addr);
          setBalance(b);
        } catch {
          /* ignore */
        }
      })();
    }
    // run only on mount
  }, []);

  const refreshBalance = async (addr?: string) => {
    try {
      const a = addr ?? address;
      if (!a) return;
      const b = await getXlmBalance(a);
      setBalance(b);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to fetch balance:", errorMsg);
      setError(errorMsg);
    }
  };

  const connect = async () => {
    setLoading(true);
    setError(null);
    try {
      // Get current network from Freighter
      const networkName = await getCurrentNetworkName();
      setNetwork(networkName);
      localStorage.setItem("walletNetwork", networkName);

      // Freighter API exposes methods on the default export
      // getPublicKey will return the active public key when Freighter is available
      // If Freighter extension is not connected or no account selected, it will show modal
      const pub = await FreighterApi.getPublicKey();
      if (!pub) {
        throw new Error("Could not get public key from Freighter");
      }
      setAddress(pub);
      localStorage.setItem("walletAddress", pub);
      setConnected(true);
      await refreshBalance(pub);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setConnected(false);
      setAddress(null);
      setBalance(null);
    } finally {
      setLoading(false);
    }
  };

  const disconnect = () => {
    setAddress(null);
    setBalance(null);
    setConnected(false);
    setError(null);
    setNetwork(null);
    localStorage.removeItem("walletAddress");
    localStorage.removeItem("walletNetwork");
  };

  const ctx = {
    address,
    balance,
    connected,
    loading,
    error,
    network,
    connect,
    disconnect,
    refreshBalance: async () => refreshBalance(),
  };

  return (
    <WalletContext.Provider value={ctx}>{children}</WalletContext.Provider>
  );
};
