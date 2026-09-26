"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  connectWithWalletModal,
  DEFAULT_WALLET_ID,
  disconnectWallet,
  getWalletAdapter,
  initializeWalletKit,
  refreshWalletAvailability,
  WALLET_ADAPTERS,
} from "@/lib/wallets/registry";
import type { WalletPlatform } from "@/lib/wallets/types";
import {
  clearWalletSession,
  loadWalletSession,
  saveWalletSession,
} from "@/lib/walletSession";

export type WalletState =
  | "unavailable"
  | "disconnected"
  | "wrong_network"
  | "connected";

export interface WalletOption {
  id: string;
  name: string;
  available: boolean | null;
  installUrl: string;
  iconUrl: string;
  platforms: WalletPlatform[];
  supportsDeepLink: boolean;
}

interface WalletContextType {
  address: string | null;
  connected: boolean;
  loading: boolean;
  reconnecting: boolean;
  error: string | null;
  walletState: WalletState;
  walletId: string;
  wallets: WalletOption[];
  connect: (walletId?: string) => Promise<string | null>;
  disconnect: () => Promise<void>;
  selectWallet: (walletId: string) => void;
}

function baseWalletOptions(): WalletOption[] {
  return WALLET_ADAPTERS.map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    available: null,
    installUrl: adapter.installUrl,
    iconUrl: adapter.iconUrl,
    platforms: adapter.platforms,
    supportsDeepLink: adapter.supportsDeepLink,
  }));
}

const defaultCtx: WalletContextType = {
  address: null,
  connected: false,
  loading: false,
  reconnecting: false,
  error: null,
  walletState: "disconnected",
  walletId: DEFAULT_WALLET_ID,
  wallets: baseWalletOptions(),
  connect: async () => null,
  disconnect: async () => {},
  selectWallet: () => {},
};

export const WalletContext = createContext<WalletContextType>(defaultCtx);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string>(DEFAULT_WALLET_ID);
  const [wallets, setWallets] = useState<WalletOption[]>(baseWalletOptions);

  const computeWallets = useCallback(async (): Promise<WalletOption[]> => {
    try {
      const availability = await refreshWalletAvailability();
      const byId = new Map(
        availability.map(({ id, available }) => [id, available]),
      );
      return baseWalletOptions().map((wallet) => ({
        ...wallet,
        available: byId.get(wallet.id) ?? false,
      }));
    } catch {
      return baseWalletOptions().map((wallet) => ({
        ...wallet,
        available: false,
      }));
    }
  }, []);

  const refreshWallets = useCallback(async () => {
    setWallets(await computeWallets());
  }, [computeWallets]);

  useEffect(() => {
    let cancelled = false;
    initializeWalletKit(loadWalletSession()?.walletId);
    void computeWallets().then((options) => {
      if (!cancelled) setWallets(options);
    });
    return () => {
      cancelled = true;
    };
  }, [computeWallets]);

  const applyConnection = useCallback((pub: string, id: string) => {
    setAddress(pub);
    setConnected(true);
    setError(null);
    setWalletId(id);
    saveWalletSession({ address: pub, connectedAt: Date.now(), walletId: id });
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

      const id = session.walletId ?? DEFAULT_WALLET_ID;
      setWalletId(id);
      setReconnecting(true);
      try {
        initializeWalletKit(id);
        const pub = await getWalletAdapter(id).getPublicKey({ silent: true });
        if (cancelled) return;

        if (!pub) {
          clearWalletSession();
          return;
        }

        applyConnection(pub, id);
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

  const connect = useCallback(
    async (requestedWalletId?: string) => {
      setLoading(true);
      setError(null);
      try {
        if (!requestedWalletId) {
          const result = await connectWithWalletModal();
          applyConnection(result.address, result.walletId);
          void refreshWallets();
          return result.address;
        }

        const adapter = getWalletAdapter(requestedWalletId);
        const pub = await adapter.getPublicKey();
        if (!pub) {
          throw new Error(`Could not get public key from ${adapter.name}`);
        }
        applyConnection(pub, adapter.id);
        void refreshWallets();
        return pub;
      } catch (err) {
        setError(errorMessage(err));
        setConnected(false);
        setAddress(null);
        void refreshWallets();
        return null;
      } finally {
        setLoading(false);
      }
    },
    [applyConnection, refreshWallets],
  );

  const disconnect = useCallback(async () => {
    try {
      await disconnectWallet();
    } finally {
      clearConnection();
      void refreshWallets();
    }
  }, [clearConnection, refreshWallets]);

  const selectWallet = useCallback((id: string) => {
    initializeWalletKit(id);
    setWalletId(id);
  }, []);

  const activeWallet = wallets.find((wallet) => wallet.id === walletId);
  const walletState: WalletState = connected
    ? "connected"
    : error && activeWallet?.available === false
      ? "unavailable"
      : "disconnected";

  return (
    <WalletContext.Provider
      value={{
        address,
        connected,
        loading,
        reconnecting,
        error,
        walletState,
        walletId,
        wallets,
        connect,
        disconnect,
        selectWallet,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
