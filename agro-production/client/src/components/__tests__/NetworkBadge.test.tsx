import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/context/WalletContext", () => ({ useWallet: vi.fn() }));

import { useWallet } from "@/context/WalletContext";
import { NetworkBadge } from "@/components/NetworkBadge";
import { TESTNET_PASSPHRASE } from "@/lib/stellarNetwork";

type WalletCtx = ReturnType<typeof useWallet>;

const mockedUseWallet = vi.mocked(useWallet);

function walletCtx(overrides: Partial<WalletCtx> = {}): WalletCtx {
  return {
    address: null,
    connected: false,
    loading: false,
    reconnecting: false,
    error: null,
    walletState: "disconnected",
    walletId: "freighter",
    wallets: [],
    networkPassphrase: null,
    expectedNetworkPassphrase: TESTNET_PASSPHRASE,
    networkStatus: "disconnected",
    networkMismatch: false,
    networkUnknown: false,
    connect: async () => null,
    disconnect: async () => {},
    selectWallet: () => {},
    ...overrides,
  };
}

describe("NetworkBadge (#1087)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseWallet.mockReturnValue(walletCtx());
  });

  it("renders nothing while no wallet is connected", () => {
    render(<NetworkBadge />);
    expect(screen.queryByTestId("network-badge")).toBeNull();
  });

  it("shows the configured network when it matches", () => {
    mockedUseWallet.mockReturnValue(
      walletCtx({
        connected: true,
        address: "GABC",
        walletState: "connected",
        networkStatus: "match",
        networkPassphrase: TESTNET_PASSPHRASE,
      }),
    );

    render(<NetworkBadge />);
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveAttribute("data-network-tone", "match");
    expect(badge).toHaveTextContent("Testnet");
    expect(badge).toHaveAttribute("aria-label", "Wallet network: Testnet");
  });

  it("surfaces a wrong network with a red tone instead of hiding it", () => {
    mockedUseWallet.mockReturnValue(
      walletCtx({
        connected: true,
        address: "GABC",
        walletState: "wrong_network",
        networkStatus: "mismatch",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
        networkMismatch: true,
      }),
    );

    render(<NetworkBadge />);
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveAttribute("data-network-tone", "mismatch");
    expect(badge).toHaveTextContent("Mainnet");
    expect(badge).toHaveAttribute("aria-label", "Wrong network: Mainnet");
  });

  it("shows an amber unknown-network state when the wallet cannot report", () => {
    mockedUseWallet.mockReturnValue(
      walletCtx({
        connected: true,
        address: "GABC",
        walletState: "unknown_network",
        networkStatus: "unknown",
        networkPassphrase: null,
        networkUnknown: true,
      }),
    );

    render(<NetworkBadge />);
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveAttribute("data-network-tone", "unknown");
    expect(badge).toHaveTextContent("an unknown network");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Network unknown: an unknown network",
    );
  });

  it("keeps a neutral checking state while the wallet has not answered", () => {
    mockedUseWallet.mockReturnValue(
      walletCtx({
        connected: true,
        address: "GABC",
        walletState: "connected",
        networkStatus: "checking",
        networkPassphrase: null,
      }),
    );

    render(<NetworkBadge />);
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveAttribute("data-network-tone", "checking");
    expect(badge).toHaveTextContent("…");
    expect(badge).toHaveAttribute(
      "title",
      "Asking the wallet which network it is on…",
    );
  });

  it("merges the caller's className", () => {
    mockedUseWallet.mockReturnValue(
      walletCtx({
        connected: true,
        address: "GABC",
        walletState: "connected",
        networkStatus: "match",
        networkPassphrase: TESTNET_PASSPHRASE,
      }),
    );

    render(<NetworkBadge className="mt-4" />);
    expect(screen.getByTestId("network-badge").className).toContain("mt-4");
  });
});
