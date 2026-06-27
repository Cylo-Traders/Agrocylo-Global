"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getFreighterPublicKey } from "@/lib/walletFreighter";
import {
  clearWalletSession,
  loadWalletSession,
  saveWalletSession,
} from "@/lib/walletSession";

export type WalletState = "unavailable" | "disconnected" | "wrong_network" | "connected";

interface WalletContextType {
  address: string | null;
  connected: boolean;
  loading: boolean;
  reconnecting: boolean;
  error: string | null;
  walletState: WalletState;
  connect: () => Promise<string | null>;
  disconnect: () => void;
}

const defaultCtx: WalletContextType = {
  address: null,
  connected: false,
  loading: false,
  reconnecting: false,
  error: null,
  walletState: "disconnected",
  connect: async () => null,
  disconnect: () => {},
};

export const WalletContext = createContext<WalletContextType>(defaultCtx);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyConnection = useCallback((pub: string) => {
    setAddress(pub);
    setConnected(true);
    setError(null);
    saveWalletSession({ address: pub, connectedAt: Date.now() });
  }, []);

  const clearConnection = useCallback(() => {
    setAddress(null);
    setConnected(false);
    setError(null);
    clearWalletSession();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const session = loadWalletSession();
      if (!session) return;

      setReconnecting(true);
      try {
        const pub = await getFreighterPublicKey();
        if (cancelled) return;

        if (!pub) {
          clearWalletSession();
          return;
        }

        if (pub !== session.address) {
          applyConnection(pub);
          return;
        }

        applyConnection(pub);
      } catch {
        if (!cancelled) clearWalletSession();
      } finally {
        if (!cancelled) setReconnecting(false);
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [applyConnection]);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pub = await getFreighterPublicKey();
      if (!pub) throw new Error("Could not get public key from Freighter");
      applyConnection(pub);
      return pub;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      setConnected(false);
      setAddress(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [applyConnection]);

  const disconnect = useCallback(() => {
    clearConnection();
  }, [clearConnection]);

  const walletState: WalletState = !connected
    ? address
      ? "wrong_network"
      : "disconnected"
    : "connected";

  return (
    <WalletContext.Provider
      value={{ address, connected, loading, reconnecting, error, walletState, connect, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
