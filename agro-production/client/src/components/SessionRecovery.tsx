import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SessionState =
  | 'active'
  | 'expired'
  | 'wallet-locked'
  | 'account-changed'
  | 'network-changed'
  | 'api-unavailable';

export interface SessionRecoveryProps {
  state: SessionState;
  /** Re-authenticate the wallet session (signature). Never called for api-unavailable. */
  onReconnect?: () => void | Promise<void>;
  /** Unlock the wallet extension/app. */
  onUnlockWallet?: () => void | Promise<void>;
  /** Rebind identity-bound state to the current account. */
  onAcceptAccountChange?: () => void | Promise<void>;
  /** Rebind identity-bound state to the current network. */
  onAcceptNetworkChange?: () => void | Promise<void>;
  /** Retry the API request without prompting a wallet signature. */
  onRetryApi?: () => void | Promise<void>;
  /** Optional current account/network labels for accurate messaging. */
  account?: string | null;
  network?: string | null;
}

interface StateDescriptor {
  title: string;
  explanation: string;
  actionLabel: string;
  /** Which handler the single next action maps to. */
  action: 'reconnect' | 'unlock' | 'accept-account' | 'accept-network' | 'retry-api';
  /** Whether this state may prompt a wallet signature. */
  requiresSignature: boolean;
}

const STATE_DESCRIPTORS: Record<Exclude<SessionState, 'active'>, StateDescriptor> = {
  expired: {
    title: 'Your session expired',
    explanation:
      'Your wallet session is no longer valid. Sign in again to keep using your account.',
    actionLabel: 'Sign in again',
    action: 'reconnect',
    requiresSignature: true,
  },
  'wallet-locked': {
    title: 'Your wallet is locked',
    explanation:
      'The wallet is locked, so it cannot confirm your identity. Unlock it to continue.',
    actionLabel: 'Unlock wallet',
    action: 'unlock',
    requiresSignature: false,
  },
  'account-changed': {
    title: 'Your wallet account changed',
    explanation:
      'A different account is now selected. Your previous identity-bound data is no longer valid.',
    actionLabel: 'Use current account',
    action: 'accept-account',
    requiresSignature: true,
  },
  'network-changed': {
    title: 'Your network changed',
    explanation:
      'The wallet switched networks. Your previous identity-bound data is no longer valid on this network.',
    actionLabel: 'Use current network',
    action: 'accept-network',
    requiresSignature: true,
  },
  'api-unavailable': {
    title: 'Service temporarily unavailable',
    explanation:
      'We could not reach the API. This is a network issue, not a wallet issue — no signature is needed.',
    actionLabel: 'Retry',
    action: 'retry-api',
    requiresSignature: false,
  },
};

/**
 * Shared session-recovery surface. Models wallet/API session states in one place,
 * gives each an accurate explanation and exactly one next action, and never
 * prompts a wallet signature for network outages.
 */
const SessionRecovery: React.FC<SessionRecoveryProps> = ({
  state,
  onReconnect,
  onUnlockWallet,
  onAcceptAccountChange,
  onAcceptNetworkChange,
  onRetryApi,
  account,
  network,
}) => {
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const previousState = useRef<SessionState>(state);

  // Announce identity-bound invalidations accessibly when they occur.
  useEffect(() => {
    if (previousState.current === state) return;
    previousState.current = state;
    if (state === 'account-changed' || state === 'network-changed') {
      const descriptor = STATE_DESCRIPTORS[state];
      setAnnouncement(`${descriptor.title}. ${descriptor.explanation}`);
    } else if (state === 'active') {
      setAnnouncement('Session restored.');
    } else {
      setAnnouncement('');
    }
  }, [state]);

  const descriptor = state === 'active' ? null : STATE_DESCRIPTORS[state];

  const handler = useMemo(() => {
    if (!descriptor) return undefined;
    switch (descriptor.action) {
      case 'reconnect':
        return onReconnect;
      case 'unlock':
        return onUnlockWallet;
      case 'accept-account':
        return onAcceptAccountChange;
      case 'accept-network':
        return onAcceptNetworkChange;
      case 'retry-api':
        return onRetryApi;
      default:
        return undefined;
    }
  }, [descriptor, onReconnect, onUnlockWallet, onAcceptAccountChange, onAcceptNetworkChange, onRetryApi]);

  const handleAction = useCallback(async () => {
    if (!handler || busy) return;
    setBusy(true);
    try {
      await handler();
    } finally {
      setBusy(false);
    }
  }, [handler, busy]);

  if (!descriptor) {
    return (
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    );
  }

  const context =
    state === 'account-changed' && account
      ? ` Current account: ${account}.`
      : state === 'network-changed' && network
      ? ` Current network: ${network}.`
      : '';

  return (
    <section
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="session-recovery"
      data-state={state}
    >
      <h2 className="session-recovery__title">{descriptor.title}</h2>
      <p className="session-recovery__explanation">
        {descriptor.explanation}
        {context}
      </p>
      <button
        type="button"
        className="session-recovery__action"
        onClick={handleAction}
        disabled={busy || !handler}
        aria-busy={busy}
      >
        {busy ? 'Working…' : descriptor.actionLabel}
      </button>
      <span aria-live="polite" role="status" className="sr-only">
        {announcement}
      </span>
    </section>
  );
};

export default SessionRecovery;
