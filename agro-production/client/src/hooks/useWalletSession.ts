import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SessionState =
  | 'connected'
  | 'expired'
  | 'wallet-locked'
  | 'account-changed'
  | 'network-changed'
  | 'api-unavailable';

export interface SessionStateInfo {
  state: SessionState;
  title: string;
  explanation: string;
  actionLabel: string;
  requiresSignature: boolean;
}

export const SESSION_STATE_INFO: Record<SessionState, SessionStateInfo> = {
  connected: {
    state: 'connected',
    title: 'Connected',
    explanation: 'Your wallet is connected and your session is active.',
    actionLabel: 'Continue',
    requiresSignature: false,
  },
  expired: {
    state: 'expired',
    title: 'Session expired',
    explanation: 'Your API session has expired. Sign in again to keep using the app.',
    actionLabel: 'Sign in again',
    requiresSignature: true,
  },
  'wallet-locked': {
    state: 'wallet-locked',
    title: 'Wallet locked',
    explanation: 'Your wallet is locked. Unlock it in your wallet app to continue.',
    actionLabel: 'Unlock wallet',
    requiresSignature: false,
  },
  'account-changed': {
    state: 'account-changed',
    title: 'Account changed',
    explanation: 'The active wallet account changed. Sign in with the new account to continue.',
    actionLabel: 'Sign in with new account',
    requiresSignature: true,
  },
  'network-changed': {
    state: 'network-changed',
    title: 'Network changed',
    explanation: 'Your wallet switched networks. Sign in again on the new network to continue.',
    actionLabel: 'Sign in on new network',
    requiresSignature: true,
  },
  'api-unavailable': {
    state: 'api-unavailable',
    title: 'Service unavailable',
    explanation: 'We cannot reach the server right now. Check your connection and retry.',
    actionLabel: 'Retry',
    requiresSignature: false,
  },
};

export interface WalletSessionOptions {
  address?: string | null;
  chainId?: number | null;
  isLocked?: boolean;
  isAuthenticated?: boolean;
  isApiReachable?: boolean;
  onSignIn?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
}

export interface WalletSession {
  state: SessionState;
  info: SessionStateInfo;
  /** Runs the single next action for the current state. Never signs during API outages. */
  recover: () => Promise<void>;
  /** Accessible announcement text for state transitions. */
  announcement: string;
}

function deriveState(options: WalletSessionOptions): SessionState {
  const { address, chainId, isLocked, isAuthenticated, isApiReachable } = options;
  if (isApiReachable === false) return 'api-unavailable';
  if (isLocked) return 'wallet-locked';
  if (!address) return 'expired';
  if (isAuthenticated) return 'connected';
  return 'expired';
}

export function useWalletSession(options: WalletSessionOptions): WalletSession {
  const { address, chainId, isLocked, isAuthenticated, isApiReachable, onSignIn, onRetry } = options;

  const [state, setState] = useState<SessionState>(() => deriveState(options));
  const [announcement, setAnnouncement] = useState('');

  const prevAddress = useRef<string | null | undefined>(address);
  const prevChainId = useRef<number | null | undefined>(chainId);

  useEffect(() => {
    const addressChanged =
      prevAddress.current !== undefined &&
      address !== undefined &&
      prevAddress.current !== address;
    const chainChanged =
      prevChainId.current !== undefined &&
      chainId !== undefined &&
      prevChainId.current !== chainId;

    prevAddress.current = address;
    prevChainId.current = chainId;

    let next: SessionState;
    if (isApiReachable === false) {
      next = 'api-unavailable';
    } else if (isLocked) {
      next = 'wallet-locked';
    } else if (addressChanged) {
      next = 'account-changed';
    } else if (chainChanged) {
      next = 'network-changed';
    } else {
      next = deriveState(options);
    }

    setState((current) => {
      if (current !== next) {
        setAnnouncement(SESSION_STATE_INFO[next].title + '. ' + SESSION_STATE_INFO[next].explanation);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chainId, isLocked, isAuthenticated, isApiReachable]);

  const recover = useCallback(async () => {
    const info = SESSION_STATE_INFO[state];
    if (state === 'api-unavailable') {
      // Network outages must never trigger a wallet signature.
      if (onRetry) await onRetry();
      return;
    }
    if (state === 'wallet-locked') {
      // Unlocking happens in the wallet; do not prompt for a signature here.
      return;
    }
    if (info.requiresSignature && onSignIn) {
      await onSignIn();
    }
  }, [state, onSignIn, onRetry]);

  const info = useMemo(() => SESSION_STATE_INFO[state], [state]);

  return { state, info, recover, announcement };
}
