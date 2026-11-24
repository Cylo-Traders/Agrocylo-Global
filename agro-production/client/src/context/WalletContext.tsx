import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { api } from '../services/api';

export type SessionStatus = 'disconnected' | 'connected' | 'authenticating' | 'authenticated' | 'expired';

interface WalletContextType {
  address: string | undefined;
  isConnected: boolean;
  isAuthenticated: boolean;
  sessionStatus: SessionStatus;
  isConnecting: boolean;
  isAuthenticating: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signIn: () => Promise<void>;
  checkSession: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('disconnected');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    if (!isConnected) {
      setIsAuthenticated(false);
      setSessionStatus('disconnected');
      return;
    }
    try {
      const { data } = await api.get('/auth/session');
      if (data?.authenticated) {
        setIsAuthenticated(true);
        setSessionStatus('authenticated');
      } else {
        setIsAuthenticated(false);
        setSessionStatus(data?.expired ? 'expired' : 'connected');
      }
    } catch (err) {
      // A transient API outage must not make the wallet look disconnected
      // or force a signature prompt. Keep the wallet connection intact and
      // leave the session state as-is so the user can retry later.
      setIsAuthenticated(false);
      setSessionStatus((prev) => (prev === 'authenticated' ? 'authenticated' : 'connected'));
    }
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) {
      setIsAuthenticated(false);
      setSessionStatus('disconnected');
      return;
    }
    setSessionStatus((prev) => (prev === 'authenticated' ? prev : 'connected'));
    checkSession();
  }, [isConnected, checkSession]);

  const connect = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const connector = connectors[0];
      if (!connector) throw new Error('No wallet connector available');
      await connectAsync({ connector });
      // Wallet is now connected; session handshake is attempted by the effect.
    } catch (err: any) {
      setError(err?.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  const signIn = async () => {
    if (!address) {
      setError('Connect your wallet before signing in');
      return;
    }
    setIsAuthenticating(true);
    setSessionStatus('authenticating');
    setError(null);
    try {
      const { data: nonceData } = await api.get('/auth/nonce');
      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to access your cart and account.',
        uri: window.location.origin,
        version: '1',
        chainId: 1,
        nonce: nonceData.nonce,
      });
      const signature = await signMessageAsync({ message: message.prepareMessage() });
      await api.post('/auth/verify', { message: message.prepareMessage(), signature });
      setIsAuthenticated(true);
      setSessionStatus('authenticated');
    } catch (err: any) {
      setIsAuthenticated(false);
      setSessionStatus('connected');
      setError(err?.message || 'Failed to sign in');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const disconnect = async () => {
    try {
      await api.post('/auth/logout').catch(() => undefined);
      await disconnectAsync();
    } catch (err: any) {
      setError(err?.message || 'Failed to disconnect wallet');
    } finally {
      setIsAuthenticated(false);
      setSessionStatus('disconnected');
    }
  };

  return (
    <WalletContext.Provider
      value={{
        address,
        isConnected,
        isAuthenticated,
        sessionStatus,
        isConnecting,
        isAuthenticating,
        error,
        connect,
        disconnect,
        signIn,
        checkSession,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
