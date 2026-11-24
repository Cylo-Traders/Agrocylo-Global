import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { WalletAdapter, WalletError } from '@solana/wallet-adapter-base';
import { useWallet, WalletContextState } from '@solana/wallet-adapter-react';
import { WalletModalProvider, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import { toast } from 'react-hot-toast';

interface WalletContextValue {
  connection: Connection;
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  wallet: WalletAdapter | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  openWalletModal: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

const RPC_ENDPOINT = process.env.REACT_APP_RPC_ENDPOINT || clusterApiUrl('mainnet-beta');

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const connection = useMemo(() => new Connection(RPC_ENDPOINT, 'confirmed'), []);
  const wallet = useWallet();
  const { setVisible } = useWalletModal();

  // Single-flight guard: prevents concurrent authorization flows from rapid
  // double-clicks or switching between responsive wallet entry points.
  const connectInFlightRef = useRef<Promise<void> | null>(null);

  const connect = useCallback(async () => {
    if (connectInFlightRef.current) {
      return connectInFlightRef.current;
    }

    if (wallet.connected || wallet.connecting) {
      return;
    }

    if (!wallet.wallet) {
      setVisible(true);
      return;
    }

    const flow = (async () => {
      try {
        await wallet.connect();
      } catch (error) {
        if (error instanceof WalletError) {
          toast.error(error.message);
        } else {
          toast.error('Failed to connect wallet');
        }
      } finally {
        connectInFlightRef.current = null;
      }
    })();

    connectInFlightRef.current = flow;
    return flow;
  }, [wallet, setVisible]);

  const disconnect = useCallback(async () => {
    try {
      await wallet.disconnect();
    } catch (error) {
      if (error instanceof WalletError) {
        toast.error(error.message);
      } else {
        toast.error('Failed to disconnect wallet');
      }
    }
  }, [wallet]);

  const openWalletModal = useCallback(() => {
    if (connectInFlightRef.current || wallet.connected || wallet.connecting) {
      return;
    }
    setVisible(true);
  }, [wallet.connected, wallet.connecting, setVisible]);

  useEffect(() => {
    if (wallet.connected) {
      connectInFlightRef.current = null;
    }
  }, [wallet.connected]);

  const value = useMemo<WalletContextValue>(
    () => ({
      connection,
      publicKey: wallet.publicKey,
      connected: wallet.connected,
      connecting: wallet.connecting,
      disconnecting: wallet.disconnecting,
      wallet: wallet.wallet,
      connect,
      disconnect,
      openWalletModal,
    }),
    [connection, wallet, connect, disconnect, openWalletModal]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWalletContext = (): WalletContextValue => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWalletContext must be used within a WalletProvider');
  }
  return context;
};

export const WalletProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <WalletModalProvider>
      <WalletProvider>{children}</WalletProvider>
    </WalletModalProvider>
  );
};

export type { WalletContextState };
