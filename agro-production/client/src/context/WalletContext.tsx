"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  WALLET_ADAPTERS,
  connectWithWalletModal,
  disconnectWallet,
  initializeWalletKit,
  refreshWalletAvailability,
} from "@/lib/wallets/registry";
import type { WalletAdapter } from "@/lib/wallets/types";
import {
  clearWalletSession,
  loadWalletSession,
  saveWalletSession,
} from "@/lib/walletSession";
import {
  EXPECTED_NETWORK_PASSPHRASE,
  compareNetworks,
  type NetworkComparison,
} from "@/lib/stellarNetwork";

export type WalletState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "wrong_network"
  | "unknown_network"
  | "unavailable"
  | "error";

export interface WalletEntry {
  id: string;
  name: string;
  iconUrl: string;
  installUrl: string;
  platforms: string[];
  supportsDeepLink: boolean;
  available: boolean | null;
}

interface WalletContextValue {
  address: string | null;
  connected: boolean;
  loading: boolean;
  reconnecting: boolean;
  error: string | null;
  walletState: WalletState;
  walletId: string | null;
  wallets: WalletEntry[];
  networkStatus: NetworkComparison | "checking";
  networkPassphrase: string | null;
  expectedNetworkPassphrase: string;
  networkMismatch: boolean;
  networkUnknown: boolean;
  connect(id?: string): Promise<string | null>;
  disconnect(): Promise<void>;
  selectWallet(id: string): void;
  signAndSubmit(xdr: string): Promise<string>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function buildWalletEntries(
  adapters: WalletAdapter[],
  availability: Map<string, boolean | null>,
): WalletEntry[] {
  return adapters.map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    iconUrl: adapter.iconUrl,
    installUrl: adapter.installUrl,
    platforms: adapter.platforms,
    supportsDeepLink: adapter.supportsDeepLink,
    available: availability.get(adapter.id) ?? null,
  }));
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [walletState, setWalletState] = useState<WalletState>("disconnected");
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networkStatus, setNetworkStatus] = useState<
    NetworkComparison | "checking"
  >("checking");
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(
    null,
  );
  const [availability, setAvailability] = useState<Map<string, boolean | null>>(
    new Map(),
  );

  const networkCheckId = useRef(0);

  const wallets = buildWalletEntries(WALLET_ADAPTERS, availability);
  const connected =
    Boolean(address) &&
    (walletState === "connected" ||
      walletState === "wrong_network" ||
      walletState === "unknown_network");
  const networkMismatch = networkStatus === "mismatch";
  const networkUnknown = networkStatus === "unknown" || networkStatus === "checking";

  const checkNetwork = useCallback(
    async (adapter: WalletAdapter) => {
      const id = ++networkCheckId.current;
      setNetworkStatus("checking");
      try {
        const details = await adapter.getNetwork();
        if (networkCheckId.current !== id) return;
        const passphrase = details?.networkPassphrase ?? null;
        setNetworkPassphrase(passphrase);
        const comparison = compareNetworks(passphrase);
        setNetworkStatus(comparison);
        setWalletState(
          comparison === "match"
            ? "connected"
            : comparison === "mismatch"
              ? "wrong_network"
              : "unknown_network",
        );
      } catch {
        if (networkCheckId.current !== id) return;
        setNetworkPassphrase(null);
        setNetworkStatus("unknown");
        setWalletState("unknown_network");
      }
    },
    [],
  );

  const selectWallet = useCallback((id: string) => {
    setWalletId(id);
  }, []);

  const connect = useCallback(
    async (id?: string): Promise<string | null> => {
      setLoading(true);
      setError(null);
      try {
        let resolvedAddress: string;
        let resolvedWalletId: string;

        if (id) {
          const adapter = WALLET_ADAPTERS.find((a) => a.id === id);
          if (!adapter) throw new Error(`Unknown wallet: ${id}`);
          const available = await adapter.isAvailable();
          if (!available) {
            setWalletState("unavailable");
            setWalletId(id);
            return null;
          }
          const pk = await adapter.getPublicKey();
          if (!pk) throw new Error("Wallet did not return a public key");
          resolvedAddress = pk;
          resolvedWalletId = id;
        } else {
          const result = await connectWithWalletModal();
          resolvedAddress = result.address;
          resolvedWalletId = result.walletId;
        }

        setAddress(resolvedAddress);
        setWalletId(resolvedWalletId);
        saveWalletSession({
          address: resolvedAddress,
          connectedAt: Date.now(),
          walletId: resolvedWalletId,
        });

        const adapter = WALLET_ADAPTERS.find((a) => a.id === resolvedWalletId);
        if (adapter) {
          await checkNetwork(adapter);
        } else {
          setWalletState("connected");
        }
        return resolvedAddress;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to connect wallet";
        setError(message);
        setWalletState("error");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [checkNetwork],
  );

  const disconnect = useCallback(async () => {
    try {
      await disconnectWallet();
    } catch {
      // best-effort
    }
    clearWalletSession();
    setAddress(null);
    setWalletId(null);
    setWalletState("disconnected");
    setNetworkStatus("checking");
    setNetworkPassphrase(null);
    setError(null);
  }, []);

  const signAndSubmit = useCallback(
    async (xdr: string): Promise<string> => {
      if (!walletId || !address) throw new Error("No wallet connected");
      const adapter = WALLET_ADAPTERS.find((a) => a.id === walletId);
      if (!adapter) throw new Error("Active wallet adapter not found");
      return adapter.signTransaction(xdr, {
        networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
        address,
      });
    },
    [walletId, address],
  );

  // Restore a persisted session on mount.
  useEffect(() => {
    const session = loadWalletSession();
    if (!session) return;

    setReconnecting(true);
    const adapter = WALLET_ADAPTERS.find((a) => a.id === session.walletId);

    (async () => {
      try {
        if (!adapter) {
          // Unknown wallet — restore address only, skip network check.
          setAddress(session.address);
          setWalletId(session.walletId ?? null);
          setWalletState("connected");
          return;
        }
        initializeWalletKit(adapter.id);
        const pk = await adapter.getPublicKey({ silent: true });
        if (!pk) {
          clearWalletSession();
          return;
        }
        setAddress(pk);
        setWalletId(adapter.id);
        await checkNetwork(adapter);
      } catch {
        clearWalletSession();
      } finally {
        setReconnecting(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh wallet availability once per mount so the wallet list reflects
  // what is actually installed in this browser.
  useEffect(() => {
    refreshWalletAvailability()
      .then((results) => {
        setAvailability(
          new Map(results.map(({ id, available }) => [id, available])),
        );
      })
      .catch(() => {
        // Non-fatal: the list still renders with available === null.
      });
  }, []);

  const value: WalletContextValue = {
    address,
    connected,
    loading,
    reconnecting,
    error,
    walletState,
    walletId,
    wallets,
    networkStatus,
    networkPassphrase,
    expectedNetworkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
    networkMismatch,
    networkUnknown,
    connect,
    disconnect,
    selectWallet,
    signAndSubmit,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
