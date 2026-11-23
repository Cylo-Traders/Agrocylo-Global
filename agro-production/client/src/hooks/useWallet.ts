import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { useAuth } from '@/contexts/AuthContext';

export type WalletSessionState =
  | 'disconnected'
  | 'connected-unauthenticated'
  | 'authenticated'
  | 'expired';

interface UseWalletReturn {
  address: string | undefined;
  isConnected: boolean;
  isAuthenticated: boolean;
  sessionState: WalletSessionState;
  isSigningIn: boolean;
  sessionError: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signIn: () => Promise<void>;
  connectors: ReturnType<typeof useConnect>['connectors'];
  connectWithConnector: ReturnType<typeof useConnect>['connect'];
}

const SESSION_ENDPOINT = '/api/auth/session';

export function useWallet(): UseWalletReturn {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { isAuthenticated, setAuthenticated } = useAuth();

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const handshakeAttempted = useRef(false);

  // Attempt the API session handshake after a wallet connects. This is a
  // read-only check: a transient API outage must NOT prompt for a signature
  // or make the wallet appear disconnected.
  useEffect(() => {
    if (!isConnected || !address) {
      handshakeAttempted.current = false;
      setSessionExpired(false);
      return;
    }
    if (isAuthenticated || handshakeAttempted.current) return;
    handshakeAttempted.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${SESSION_ENDPOINT}?address=${address}`, {
          method: 'GET',
          credentials: 'include',
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data?.authenticated) {
            setAuthenticated(true);
            setSessionExpired(false);
          } else if (data?.expired) {
            setSessionExpired(true);
          }
        }
        // Non-OK (e.g. 5xx outage): leave state as connected-unauthenticated
        // without surfacing an error or prompting a signature.
      } catch {
        // Network/API outage: do not treat as a wallet failure.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, isAuthenticated, setAuthenticated]);

  const connect = useCallback(async () => {
    const connector = connectors[0];
    if (!connector) return;
    await connectAsync({ connector });
  }, [connectors, connectAsync]);

  const disconnect = useCallback(async () => {
    await disconnectAsync();
    setAuthenticated(false);
    setSessionExpired(false);
    setSessionError(null);
  }, [disconnectAsync, setAuthenticated]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setIsSigningIn(true);
    setSessionError(null);
    try {
      const nonceRes = await fetch('/api/auth/nonce', { credentials: 'include' });
      if (!nonceRes.ok) throw new Error('Unable to start sign-in');
      const { nonce } = await nonceRes.json();

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to use your cart and account.',
        uri: window.location.origin,
        version: '1',
        chainId: 1,
        nonce,
      });
      const prepared = message.prepareMessage();
      const signature = await signMessageAsync({ message: prepared });

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prepared, signature }),
      });
      if (!verifyRes.ok) throw new Error('Signature verification failed');

      setAuthenticated(true);
      setSessionExpired(false);
    } catch (err) {
      setSessionError(
        err instanceof Error ? err.message : 'Sign-in failed. Please try again.'
      );
    } finally {
      setIsSigningIn(false);
    }
  }, [address, signMessageAsync, setAuthenticated]);

  const sessionState: WalletSessionState = !isConnected
    ? 'disconnected'
    : isAuthenticated
      ? 'authenticated'
      : sessionExpired
        ? 'expired'
        : 'connected-unauthenticated';

  return {
    address,
    isConnected,
    isAuthenticated,
    sessionState,
    isSigningIn,
    sessionError,
    connect,
    disconnect,
    signIn,
    connectors,
    connectWithConnector: connectAsync,
  };
}
