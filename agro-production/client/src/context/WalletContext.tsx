"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  EXPECTED_NETWORK_PASSPHRASE,
  compareNetworks,
  type NetworkComparison,
} from "@/lib/stellarNetwork";
import {
  clearWalletSession,
  loadWalletSession,
  saveWalletSession,
} from "@/lib/walletSession";

export type WalletState =
  | "unavailable"
  | "disconnected"
  | "wrong_network"
  | "unknown_network"
  | "connected";

/**
 * Where the connected wallet is, relative to the network this app is
 * configured for (#1087).
 *
 * - `disconnected` — no wallet connected.
 * - `checking` — connected, but the wallet has not answered `getNetwork()` yet.
 * - `unknown` — the wallet answered "I don't know". Never treated as a match.
 * - `mismatch` — the wallet is on a different network than the app expects.
 * - `match` — wallet and app agree; signing is allowed.
 */
export type WalletNetworkStatus =
  | "disconnected"
  | "checking"
  | NetworkComparison;

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
  /** The passphrase the connected wallet reports, or null when unknown. */
  networkPassphrase: string | null;
  /** The passphrase this deployment is configured for. */
  expectedNetworkPassphrase: string;
  /** Match / mismatch / unknown / checking / disconnected. */
  networkStatus: WalletNetworkStatus;
  /** Convenience: true only for a *known* wrong network. */
  networkMismatch: boolean;
  /** True when connected but the wallet cannot report its network. */
  networkUnknown: boolean;
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
  networkPassphrase: null,
  expectedNetworkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
  networkStatus: "disconnected",
  networkMismatch: false,
  networkUnknown: false,
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
  // The last network report from the wallet, keyed by the connection it
  // describes. Keying is what makes a wallet switch safe: a passphrase read
  // for the previous connection can never be believed for the new one, and
  // until the new answer arrives the network is `checking`, not `match`.
  const [networkReport, setNetworkReport] = useState<{
    key: string;
    passphrase: string | null;
  } | null>(null);
  const networkRequestRef = useRef(0);

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

  /**
   * Ask the adapter which network it is on (#1087).
   *
   * A request counter guards against a late answer from a wallet the user has
   * already switched away from: only the newest read may update state. An
   * adapter that cannot answer (or throws) reports `null` — unknown — and is
   * never replaced with the configured passphrase.
   */
  const refreshNetwork = useCallback(async (id: string, pub: string) => {
    const request = ++networkRequestRef.current;
    const key = `${id}:${pub}`;
    let passphrase: string | null = null;
    try {
      const details = await getWalletAdapter(id).getNetwork();
      passphrase = details?.networkPassphrase ?? null;
    } catch {
      passphrase = null;
    }
    if (request !== networkRequestRef.current) return; // superseded
    setNetworkReport({ key, passphrase });
  }, []);

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

  const applyConnection = useCallback(
    (pub: string, id: string) => {
      setAddress(pub);
      setConnected(true);
      setError(null);
      setWalletId(id);
      saveWalletSession({ address: pub, connectedAt: Date.now(), walletId: id });
      void refreshNetwork(id, pub);
    },
    [refreshNetwork],
  );

  const clearConnection = useCallback(() => {
    // Invalidate any in-flight network read so it cannot resurrect a report
    // for a wallet that is no longer connected.
    networkRequestRef.current += 1;
    setNetworkReport(null);
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

  // Only believe a network report that describes the current connection.
  const networkKey =
    connected && address ? `${walletId}:${address}` : null;
  const networkPassphrase =
    networkReport && networkReport.key === networkKey
      ? networkReport.passphrase
      : null;
  const networkComparison = compareNetworks(networkPassphrase);
  const networkStatus: WalletNetworkStatus = !connected
    ? "disconnected"
    : networkPassphrase !== null
      ? networkComparison
      : networkReport && networkReport.key === networkKey
        ? "unknown" // the wallet answered, but could not name its network
        : "checking"; // the wallet has not answered yet

  const walletState: WalletState = connected
    ? networkStatus === "mismatch"
      ? "wrong_network"
      : networkStatus === "unknown"
        ? "unknown_network"
        : "connected"
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
        networkPassphrase,
        expectedNetworkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
        networkStatus,
        networkMismatch: networkStatus === "mismatch",
        networkUnknown: networkStatus === "unknown",
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
