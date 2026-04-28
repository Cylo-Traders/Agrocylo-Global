"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import FreighterApi from "@stellar/freighter-api";

interface WalletContextType {
  address: string | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const defaultCtx: WalletContextType = {
  address: null,
  connected: false,
  loading: false,
  error: null,
  connect: async () => {},
  disconnect: () => {},
};

export const WalletContext = createContext<WalletContextType>(defaultCtx);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("ap_walletAddress") : null;
    if (saved) {
      setAddress(saved);
      setConnected(true);
    }
  }, []);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const w = typeof window !== "undefined" ? (window as Record<string, unknown>) : null;
      const freighterDirect =
        (w?.freighter as { getPublicKey?: unknown } | undefined)?.getPublicKey
          ? (w!.freighter as { getPublicKey: () => Promise<string> })
          : (w?.freighterApi as { getPublicKey?: unknown } | undefined)?.getPublicKey
          ? (w!.freighterApi as { getPublicKey: () => Promise<string> })
          : null;

      const pub = freighterDirect
        ? await freighterDirect.getPublicKey()
        : await FreighterApi.getPublicKey();

      if (!pub) throw new Error("Could not get public key from Freighter");

      setAddress(pub);
      setConnected(true);
      if (typeof window !== "undefined") localStorage.setItem("ap_walletAddress", pub);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setConnected(false);
    setError(null);
    if (typeof window !== "undefined") localStorage.removeItem("ap_walletAddress");
  }, []);

  return (
    <WalletContext.Provider value={{ address, connected, loading, error, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
