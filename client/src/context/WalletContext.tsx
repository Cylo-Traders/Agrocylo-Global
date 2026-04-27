"use client";

import React, { createContext, useCallback, useEffect, useState } from "react";
import type { WalletContextType } from "../types/wallet";
import { getXlmBalance, getCurrentNetworkName } from "../lib/stellar";
import { signAndSubmitTransaction } from "../lib/signTransaction";
import type { SignAndSubmitResult } from "../lib/signTransaction";
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
  signAndSubmit: async () => ({ success: false, error: "Wallet not connected" }),
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
      // Prefer window.freighter / window.freighterApi if available (e.g. Playwright test mocks).
      // The @stellar/freighter-api npm package uses browser-extension messaging which
      // is unavailable in headless test contexts.
      const w = typeof window !== "undefined" ? (window as any) : null;
      const freighterDirect =
        w?.freighter?.getPublicKey ? w.freighter :
        w?.freighterApi?.getPublicKey ? w.freighterApi :
        null;

      // Get current network
      const networkName = freighterDirect?.getNetwork
        ? await freighterDirect.getNetwork()
        : await getCurrentNetworkName();
      setNetwork(networkName);
      localStorage.setItem("walletNetwork", networkName);

      // Get public key
      const pub = freighterDirect
        ? await freighterDirect.getPublicKey()
        : await FreighterApi.getPublicKey();
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

  const signAndSubmit = useCallback(
    async (transactionXdr: string): Promise<SignAndSubmitResult> => {
      if (!connected || !address) {
        return { success: false, error: "Wallet not connected" };
      }
      setError(null);
      try {
        const result = await signAndSubmitTransaction(transactionXdr);
        // Refresh balance after a successful on-chain transaction
        if (result.success) {
          await refreshBalance();
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return { success: false, error: msg };
      }
    },
    [connected, address]
  );

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
    signAndSubmit,
  };

  return (
    <WalletContext.Provider value={ctx}>{children}</WalletContext.Provider>
  );
};
