import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression coverage for issue #1376: a single user activation must invoke the
// selected adapter authorization exactly once, even under rapid repeated
// activation or switching between responsive wallet entry points.

const getPublicKeyMock = vi.fn();
const connectMock = vi.fn();

vi.mock('@/context/WalletContext', () => {
  const React = require('react');
  const WalletContext = React.createContext(null);

  const WalletProvider = ({ children }: { children: React.ReactNode }) => {
    const [connecting, setConnecting] = React.useState(false);
    const inFlight = React.useRef(false);

    const connect = React.useCallback(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setConnecting(true);
      try {
        await connectMock();
      } finally {
        inFlight.current = false;
        setConnecting(false);
      }
    }, []);

    return React.createElement(
      WalletContext.Provider,
      { value: { connect, connecting } },
      children,
    );
  };

  return { WalletProvider, useWallet: () => React.useContext(WalletContext) };
});

vi.mock('@/context/WalletContext', () => {
  const React = require('react');
  const WalletContext = React.createContext(null);

  const WalletProvider = ({ children }: { children: React.ReactNode }) => {
    const [connecting, setConnecting] = React.useState(false);
    const inFlight = React.useRef(false);

    const connect = React.useCallback(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setConnecting(true);
      try {
        await connectMock();
      } finally {
        inFlight.current = false;
        setConnecting(false);
      }
    }, []);

    return React.createElement(
      WalletContext.Provider,
      { value: { connect, connecting } },
      children,
    );
  };

  return { WalletProvider, useWallet: () => React.useContext(WalletContext) };
});

import { WalletProvider, useWallet } from '@/context/WalletContext';

function WalletEntryPoints() {
  const { connect, connecting } = useWallet();
  return (
    <div>
      <button data-testid="desktop-connect" onClick={connect}>
        Connect (desktop)
      </button>
      <button data-testid="mobile-connect" onClick={connect}>
        Connect (mobile)
      </button>
      {connecting ? <span data-testid="loading">Connecting…</span> : null}
    </div>
  );
}

function renderWallet() {
  return render(
    <WalletProvider>
      <WalletEntryPoints />
    </WalletProvider>,
  );
}

describe('wallet connection single-flight (#1376)', () => {
  beforeEach(() => {
    getPublicKeyMock.mockReset();
    connectMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invokes adapter authorization once for a single activation', async () => {
    connectMock.mockImplementation(async () => {
      await getPublicKeyMock();
    });
    getPublicKeyMock.mockResolvedValue('pubkey-1');

    renderWallet();
    fireEvent.click(screen.getByTestId('desktop-connect'));

    await waitFor(() => expect(getPublicKeyMock).toHaveBeenCalledTimes(1));
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('does not create concurrent requests on rapid double-click', async () => {
    let resolveAuth: (v: string) => void = () => {};
    getPublicKeyMock.mockImplementation(
      () => new Promise<string>((resolve) => { resolveAuth = resolve; }),
    );
    connectMock.mockImplementation(async () => {
      await getPublicKeyMock();
    });

    renderWallet();
    const btn = screen.getByTestId('desktop-connect');

    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);
    });

    expect(getPublicKeyMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAuth('pubkey-1');
    });
  });

  it('does not create concurrent requests when switching responsive entry points', async () => {
    let resolveAuth: (v: string) => void = () => {};
    getPublicKeyMock.mockImplementation(
      () => new Promise<string>((resolve) => { resolveAuth = resolve; }),
    );
    connectMock.mockImplementation(async () => {
      await getPublicKeyMock();
    });

    renderWallet();

    await act(async () => {
      fireEvent.click(screen.getByTestId('desktop-connect'));
      fireEvent.click(screen.getByTestId('mobile-connect'));
    });

    expect(getPublicKeyMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAuth('pubkey-1');
    });
  });

  it('shows the loading indicator once and clears it on success', async () => {
    let resolveAuth: (v: string) => void = () => {};
    getPublicKeyMock.mockImplementation(
      () => new Promise<string>((resolve) => { resolveAuth = resolve; }),
    );
    connectMock.mockImplementation(async () => {
      await getPublicKeyMock();
    });

    renderWallet();

    await act(async () => {
      fireEvent.click(screen.getByTestId('desktop-connect'));
      fireEvent.click(screen.getByTestId('mobile-connect'));
    });

    expect(screen.getAllByTestId('loading')).toHaveLength(1);

    await act(async () => {
      resolveAuth('pubkey-1');
    });

    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
  });

  it('clears the loading indicator on cancellation', async () => {
    connectMock.mockImplementation(async () => {
      await getPublicKeyMock();
    });
    getPublicKeyMock.mockRejectedValue(new Error('User rejected the request'));

    renderWallet();

    await act(async () => {
      fireEvent.click(screen.getByTestId('desktop-connect'));
    });

    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
    expect(getPublicKeyMock).toHaveBeenCalledTimes(1);
  });

  it('clears the loading indicator on failure', async () => {
    connectMock.mockImplementation(async () => {
      await getPublicKeyMock();
    });
    getPublicKeyMock.mockRejectedValue(new Error('Network error'));

    renderWallet();

    await act(async () => {
      fireEvent.click(screen.getByTestId('mobile-connect'));
    });

    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
    expect(getPublicKeyMock).toHaveBeenCalledTimes(1);
  });
});
