"use client";

import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WalletContextType } from "../types/wallet";
import { getXlmBalance } from "../lib/stellar";
import {
  signAndSubmitTransaction,
  NetworkMismatchError,
} from "../lib/stellarTransactions";
import type { SignAndSubmitResult } from "../lib/stellarTransactions";
import {
  isNetworkMismatch,
  normalizeToPassphrase,
  getExpectedNetworkPassphrase,
} from "@/services/stellar/networkConfig";
import { trackWalletConnected, trackWalletDisconnected } from "@/lib/analytics";
import {
  WALLET_ADAPTERS,
  getPreferredAdapter,
  savePreferredAdapter,
  FreighterAdapter,
} from "../lib/walletAdapters";
import { authenticateWallet, logoutWalletSession } from "@/lib/walletSession";

const CONNECT_TIMEOUT_MS = 12_000;
const WALLET_POLL_INTERVAL_MS = 5_000;
const WALLET_EVENT_DEBOUNCE_MS = 500;

const initialState: WalletContextType = {
  address: null,
  balance: null,
  connected: false,
  loading: false,
  restoring: false,
  authenticated: false,
  authenticating: false,
  sessionError: null,
  error: null,
  network: null,
  networkMismatch: false,
  activeWalletId: null,
  connect: async () => {},
  disconnect: () => {},
  refreshBalance: async () => {},
  reauthenticate: async () => {},
  signAndSubmit: async () => ({
    success: false,
    error: "Wallet not connected",
  }),
};

export const WalletContext = createContext<WalletContextType>(initialState);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const restoreGenerationRef = useRef(0);
  const connectGenerationRef = useRef(0);
  const identitySyncRef = useRef(false);
  const lastWalletEventRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const cachedAddr = localStorage.getItem("walletAddress");
    const cachedNet = localStorage.getItem("walletNetwork");
    const cachedWalletId = localStorage.getItem("activeWalletId");
    if (!cachedAddr) {
      // No cached wallet, ensure restoring is false even after StrictMode double mount
      if (mountedRef.current) setRestoring(false);
      return;
    }

    const generation = ++restoreGenerationRef.current;
    let cancelled = false;
    // Ensure mounted is true for this effect instance (covers StrictMode remount)
    mountedRef.current = true;
    setRestoring(true);

    (async () => {
      try {
        const adapter =
          WALLET_ADAPTERS.find((a) => a.id === cachedWalletId) ??
          FreighterAdapter;
        const livePub = await adapter.getPublicKey();
        if (cancelled) return;
        if (generation !== restoreGenerationRef.current) return;
        if (!mountedRef.current) return;

        const liveNet = await adapter.getNetwork();
        if (cancelled) return;
        if (generation !== restoreGenerationRef.current) return;
        if (!mountedRef.current) return;

        if (livePub !== cachedAddr) {
          localStorage.setItem("walletAddress", livePub);
        }
        if (liveNet !== cachedNet) {
          localStorage.setItem("walletNetwork", liveNet);
        }

        setAddress(livePub);
        setNetwork(liveNet);
        setConnected(true);
        if (cachedWalletId) setActiveWalletId(cachedWalletId);

        try {
          const b = await getXlmBalance(livePub);
          if (cancelled) return;
          if (generation !== restoreGenerationRef.current) return;
          if (!mountedRef.current) return;
          setBalance(b);
        } catch {
          // balance failure is non-fatal; still consider restored
        }
      } catch {
        if (cancelled) return;
        if (generation !== restoreGenerationRef.current) return;
        if (!mountedRef.current) return;
        localStorage.removeItem("walletAddress");
        localStorage.removeItem("walletNetwork");
        localStorage.removeItem("activeWalletId");
        setAddress(null);
        setConnected(false);
        setNetwork(null);
        setActiveWalletId(null);
        setBalance(null);
      } finally {
        if (cancelled) return;
        if (generation !== restoreGenerationRef.current) return;
        if (!mountedRef.current) return;
        setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshBalance = useCallback(async () => {
    try {
      const a = address;
      if (!a) return;
      const b = await getXlmBalance(a);
      if (mountedRef.current) setBalance(b);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to fetch balance:", errorMsg);
      if (mountedRef.current) setError(errorMsg);
    }
  }, [address]);

  const connect = useCallback(async (adapterId?: string) => {
    const generation = ++connectGenerationRef.current;
    let cancelled = false;
    // Ensure mounted true for StrictMode remount; connect is user-initiated so should be true
    mountedRef.current = true;
    setLoading(true);
    setError(null);

    const adapter =
      (adapterId ? WALLET_ADAPTERS.find((a) => a.id === adapterId) : null) ??
      getPreferredAdapter();

    const isMobile =
      typeof navigator !== "undefined" &&
      /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

    if (isMobile && !adapter.supportsMobile()) {
      const deepLink = adapter.mobileDeepLink();
      const hint = deepLink
        ? `Open ${adapter.name} at ${deepLink} and try again.`
        : `${adapter.name} is not supported on mobile. Please use a desktop browser with the ${adapter.name} extension installed.`;
      if (
        generation === connectGenerationRef.current &&
        !cancelled &&
        mountedRef.current
      ) {
        setError(hint);
        setLoading(false);
      }
      return;
    }

    if (isMobile && !adapter.supportsMobile()) {
      const deepLink = adapter.mobileDeepLink();
      const hint = deepLink
        ? `Open ${adapter.name} at ${deepLink} and try again.`
        : `${adapter.name} is not supported on mobile. Please use a desktop browser with the ${adapter.name} extension installed.`;
      setError(hint);
      setLoading(false);
      return;
    }

    try {
      const pub = await Promise.race([
        adapter.getPublicKey(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s. ` +
                    `Make sure ${adapter.name} is unlocked and try again.`,
                ),
              ),
            CONNECT_TIMEOUT_MS,
          ),
        ),
      ]);

      if (!mountedRef.current) return;

      if (cancelled) return;
      if (generation !== connectGenerationRef.current) return;
      if (!mountedRef.current) return;

      const networkName = await adapter.getNetwork();
      if (cancelled) return;
      if (generation !== connectGenerationRef.current) return;
      if (!mountedRef.current) return;

      setAddress(pub);
      setNetwork(networkName);
      setConnected(true);
      setActiveWalletId(adapter.id);
      trackWalletConnected(pub, {
        network: networkName,
        adapter: adapter.name,
      });

      localStorage.setItem("walletAddress", pub);
      localStorage.setItem("walletNetwork", networkName);
      localStorage.setItem("activeWalletId", adapter.id);
      savePreferredAdapter(adapter.id);

      try {
        const b = await getXlmBalance(pub);
        if (cancelled) return;
        if (generation !== connectGenerationRef.current) return;
        if (!mountedRef.current) return;
        setBalance(b);
      } catch {
        // non-fatal
      }
    } catch (err: unknown) {
      if (cancelled) return;
      if (generation !== connectGenerationRef.current) return;
      if (!mountedRef.current) return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setConnected(false);
      setAddress(null);
      setBalance(null);
      setNetwork(null);
      setActiveWalletId(null);
    } finally {
      if (cancelled) return;
      if (generation !== connectGenerationRef.current) return;
      if (!mountedRef.current) return;
      setLoading(false);
    }

    // Cleanup for this connect operation in case component unmounts before async completes
    // Note: we don't return cleanup from useCallback, but we track cancelled via closure if needed externally
    // The generation check ensures superseded connects are ignored.
    void cancelled;
  }, []);

  const disconnect = useCallback(() => {
    // Increment generations to cancel any in-flight restore/connect
    restoreGenerationRef.current += 1;
    connectGenerationRef.current += 1;
    if (address) {
      trackWalletDisconnected({
        network: network ?? undefined,
        adapter: activeWalletId ?? undefined,
      });
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("walletIdentityChanged"));
    }
    setAddress(null);
    setBalance(null);
    setConnected(false);
    setError(null);
    setNetwork(null);
    setActiveWalletId(null);
    setLoading(false);
    setRestoring(false);
    localStorage.removeItem("walletAddress");
    localStorage.removeItem("walletNetwork");
    localStorage.removeItem("activeWalletId");
  }, [address, network, activeWalletId]);

  const reauthenticate = useCallback(async () => {
    if (!address || !activeWalletId) return;
    const adapter = WALLET_ADAPTERS.find((item) => item.id === activeWalletId);
    if (!adapter) return;

    setAuthenticating(true);
    setSessionError(null);
    try {
      await authenticateWallet(adapter, address);
      if (mountedRef.current) setAuthenticated(true);
    } catch (err) {
      if (!mountedRef.current) return;
      setAuthenticated(false);
      setSessionError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setAuthenticating(false);
    }
  }, [activeWalletId, address]);

  useEffect(() => {
    if (
      !connected ||
      !activeWalletId ||
      !address ||
      typeof window === "undefined"
    ) {
      return;
    }

    const adapter = WALLET_ADAPTERS.find((item) => item.id === activeWalletId);
    if (!adapter) return;
    let cancelled = false;

    const reconcileIdentity = async () => {
      if (cancelled || identitySyncRef.current) return;
      identitySyncRef.current = true;
      try {
        const [liveAddress, liveNetwork] = await Promise.all([
          adapter.getPublicKey(),
          adapter.getNetwork(),
        ]);
        if (cancelled || !mountedRef.current) return;

        const accountChanged = liveAddress !== address;
        const networkChanged = liveNetwork !== network;
        if (!accountChanged && !networkChanged) return;

        setAuthenticated(false);
        setSessionError(null);
        void logoutWalletSession();
        window.dispatchEvent(new Event("walletIdentityChanged"));
        setBalance(null);
        setAddress(liveAddress);
        setNetwork(liveNetwork);
        localStorage.setItem("walletAddress", liveAddress);
        localStorage.setItem("walletNetwork", liveNetwork);
        setError(
          accountChanged
            ? "Wallet account changed. Previous wallet data and transaction intent were cleared."
            : "Wallet network changed. Previous wallet data and transaction intent were cleared.",
        );

        try {
          const liveBalance = await getXlmBalance(liveAddress);
          if (!cancelled && mountedRef.current) setBalance(liveBalance);
        } catch {
          // Balance refresh is non-fatal after an identity change.
        }
      } catch {
        if (cancelled || !mountedRef.current) return;
        setAuthenticated(false);
        setSessionError(null);
        void logoutWalletSession();
        window.dispatchEvent(new Event("walletIdentityChanged"));
        setError("Wallet is locked or disconnected. Please reconnect.");
        setAddress(null);
        setBalance(null);
        setNetwork(null);
        setConnected(false);
        setActiveWalletId(null);
        localStorage.removeItem("walletAddress");
        localStorage.removeItem("walletNetwork");
        localStorage.removeItem("activeWalletId");
      } finally {
        identitySyncRef.current = false;
      }
    };

    const handleProviderEvent = () => {
      const now = Date.now();
      if (now - lastWalletEventRef.current < WALLET_EVENT_DEBOUNCE_MS) return;
      lastWalletEventRef.current = now;
      void reconcileIdentity();
    };
    const provider = (window as Window & { freighter?: unknown }).freighter as
      | {
          on?: (event: string, listener: () => void) => void;
          removeListener?: (event: string, listener: () => void) => void;
        }
      | undefined;
    const providerEvents = ["accountsChanged", "chainChanged", "disconnect"];
    providerEvents.forEach((event) =>
      provider?.on?.(event, handleProviderEvent),
    );
    [
      "accountsChanged",
      "chainChanged",
      "walletChanged",
      "walletDisconnected",
    ].forEach((event) => window.addEventListener(event, handleProviderEvent));
    const interval = window.setInterval(
      reconcileIdentity,
      WALLET_POLL_INTERVAL_MS,
    );

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      providerEvents.forEach((event) =>
        provider?.removeListener?.(event, handleProviderEvent),
      );
      [
        "accountsChanged",
        "chainChanged",
        "walletChanged",
        "walletDisconnected",
      ].forEach((event) =>
        window.removeEventListener(event, handleProviderEvent),
      );
    };
  }, [activeWalletId, address, connected, network]);

  // Compare the connected wallet's active network against the network the app
  // is configured for. Recomputed whenever the wallet reports a network change.
  const networkMismatch = useMemo(
    () => (connected ? isNetworkMismatch(network) : false),
    [connected, network],
  );

  const signAndSubmit = useCallback(
    async (transactionXdr: string): Promise<SignAndSubmitResult> => {
      if (!connected || !address) {
        return { success: false, error: "Wallet not connected" };
      }
      if (isNetworkMismatch(network)) {
        let expected = "the configured network";
        try {
          expected = getExpectedNetworkPassphrase();
        } catch {
          /* keep generic label */
        }
        const err = new NetworkMismatchError(
          normalizeToPassphrase(network) ?? network ?? "unknown",
          expected,
        );
        if (mountedRef.current) setError(err.message);
        return { success: false, error: err.message, errorKind: "mismatch" };
      }
      setError(null);
      try {
        const result = await signAndSubmitTransaction(transactionXdr);
        if (result.success) {
          const b = await getXlmBalance(address);
          if (mountedRef.current) setBalance(b);
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (mountedRef.current) setError(msg);
        return { success: false, error: msg };
      }
    },
    [connected, address, network],
  );

  const value = useMemo<WalletContextType>(
    () => ({
      address,
      balance,
      connected,
      loading,
      restoring,
      error,
      network,
      networkMismatch,
      activeWalletId,
      authenticated,
      authenticating,
      sessionError,
      connect,
      disconnect,
      refreshBalance,
      reauthenticate,
      signAndSubmit,
    }),
    [
      address,
      balance,
      connected,
      loading,
      restoring,
      error,
      network,
      networkMismatch,
      activeWalletId,
      authenticated,
      authenticating,
      sessionError,
      connect,
      disconnect,
      refreshBalance,
      reauthenticate,
      signAndSubmit,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
};
