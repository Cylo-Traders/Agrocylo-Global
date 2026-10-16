import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/context/WalletContext", () => ({ useWallet: vi.fn() }));

import { useWallet } from "@/context/WalletContext";
import { NetworkMismatchBanner } from "@/components/NetworkMismatchBanner";
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

describe("NetworkMismatchBanner (#1087)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseWallet.mockReturnValue(walletCtx());
  });

  it("renders nothing while no wallet is connected", () => {
    render(<NetworkMismatchBanner />);
    expect(screen.queryByTestId("network-mismatch-banner")).toBeNull();
  });

  it("renders nothing when the networks match", () => {
    mockedUseWallet.mockReturnValue(
      walletCtx({
        connected: true,
        address: "GABC",
        walletState: "connected",
        networkStatus: "match",
        networkPassphrase: TESTNET_PASSPHRASE,
      }),
    );

    render(<NetworkMismatchBanner />);
    expect(screen.queryByTestId("network-mismatch-banner")).toBeNull();
  });

  it("shows an assertive alert naming both networks on a mismatch", () => {
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

    render(<NetworkMismatchBanner />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveAttribute("data-testid", "network-mismatch-banner");
    expect(banner).toHaveAttribute("aria-live", "assertive");
    expect(banner).toHaveTextContent("Wrong wallet network");
    expect(banner).toHaveTextContent("Mainnet");
    expect(banner).toHaveTextContent("Testnet");
    expect(banner).toHaveTextContent("blocked until it matches");
  });

  it("explains an unknown wallet network instead of hiding it", () => {
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

    render(<NetworkMismatchBanner />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Wallet network unknown");
    expect(banner).toHaveTextContent("did not report which network");
    expect(banner).toHaveTextContent("Testnet");
  });
});
