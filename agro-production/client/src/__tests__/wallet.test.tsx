import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveWalletSession } from "../lib/walletSession";

const walletMocks = vi.hoisted(() => {
  const getPublicKey = vi.fn();
  return {
    getPublicKey,
    disconnect: vi.fn(async () => undefined),
    connectModal: vi.fn(async () => ({
      address: "GMODALADDRESS",
      walletId: "xbull",
    })),
    refresh: vi.fn(async () => [
      { id: "freighter", available: true },
      { id: "xbull", available: true },
    ]),
    initialize: vi.fn(),
  };
});

vi.mock("@/lib/wallets/registry", () => {
  const adapters = [
    {
      id: "freighter",
      name: "Freighter",
      iconUrl: "freighter.png",
      installUrl: "https://freighter.app",
      moduleType: "HOT_WALLET",
      platforms: ["browser", "mobile"],
      supportsDeepLink: false,
      isAvailable: vi.fn(async () => true),
      getPublicKey: walletMocks.getPublicKey,
      getNetwork: vi.fn(async () => null),
      signTransaction: vi.fn(),
      disconnect: walletMocks.disconnect,
    },
    {
      id: "xbull",
      name: "xBull",
      iconUrl: "xbull.png",
      installUrl: "https://xbull.app",
      moduleType: "HOT_WALLET",
      platforms: ["browser", "mobile"],
      supportsDeepLink: true,
      isAvailable: vi.fn(async () => true),
      getPublicKey: walletMocks.getPublicKey,
      getNetwork: vi.fn(async () => null),
      signTransaction: vi.fn(),
      disconnect: walletMocks.disconnect,
    },
  ];
  return {
    DEFAULT_WALLET_ID: "freighter",
    WALLET_ADAPTERS: adapters,
    getWalletAdapter: (id?: string) =>
      adapters.find((adapter) => adapter.id === id) ?? adapters[0],
    connectWithWalletModal: walletMocks.connectModal,
    disconnectWallet: walletMocks.disconnect,
    initializeWalletKit: walletMocks.initialize,
    refreshWalletAvailability: walletMocks.refresh,
  };
});

import { WalletProvider, useWallet } from "../context/WalletContext";

function TestConsumer() {
  const context = useWallet();
  return (
    <div>
      <span data-testid="addr">{context.address ?? "-"}</span>
      <span data-testid="wallet">{context.walletId}</span>
      <button onClick={() => void context.connect()}>connect-modal</button>
      <button onClick={() => void context.connect("freighter")}>
        connect-freighter
      </button>
      <button onClick={() => void context.disconnect()}>disconnect</button>
      <span data-testid="connected">{String(context.connected)}</span>
      <span data-testid="reconnecting">{String(context.reconnecting)}</span>
      {context.error && <span role="alert">{context.error}</span>}
    </div>
  );
}

describe("WalletProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.clear();
    walletMocks.refresh.mockResolvedValue([
      { id: "freighter", available: true },
      { id: "xbull", available: true },
    ]);
    walletMocks.connectModal.mockResolvedValue({
      address: "GMODALADDRESS",
      walletId: "xbull",
    });
  });

  it("opens the kit modal and records its selected wallet", async () => {
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await act(async () => {
      screen.getByText("connect-modal").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("connected")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("addr")).toHaveTextContent("GMODALADDRESS");
    expect(screen.getByTestId("wallet")).toHaveTextContent("xbull");
    expect(localStorage.getItem("ap_walletSession")).toContain('"walletId":"xbull"');
  });

  it("connects a specifically selected provider through the shared adapter", async () => {
    walletMocks.getPublicKey.mockResolvedValueOnce("GFREIGHTER");

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await act(async () => {
      screen.getByText("connect-freighter").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("addr")).toHaveTextContent("GFREIGHTER"),
    );
    expect(walletMocks.getPublicKey).toHaveBeenCalledWith();
  });

  it("reconnects a persisted selection without opening a permission prompt", async () => {
    saveWalletSession({
      address: "GSAVED",
      connectedAt: Date.now(),
      walletId: "freighter",
    });
    walletMocks.getPublicKey.mockResolvedValueOnce("GSAVED");

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("connected")).toHaveTextContent("true"),
    );
    expect(walletMocks.getPublicKey).toHaveBeenCalledWith({ silent: true });
    expect(walletMocks.connectModal).not.toHaveBeenCalled();
  });

  it("clears a stale persisted session", async () => {
    saveWalletSession({
      address: "GSTALE",
      connectedAt: Date.now(),
      walletId: "freighter",
    });
    walletMocks.getPublicKey.mockResolvedValueOnce(null);

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("reconnecting")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("connected")).toHaveTextContent("false");
    expect(localStorage.getItem("ap_walletSession")).toBeNull();
  });

  it("disconnects the kit and clears the application session", async () => {
    walletMocks.connectModal.mockResolvedValueOnce({
      address: "GCONNECTED",
      walletId: "xbull",
    });

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await act(async () => {
      screen.getByText("connect-modal").click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("connected")).toHaveTextContent("true"),
    );

    await act(async () => {
      screen.getByText("disconnect").click();
    });

    expect(walletMocks.disconnect).toHaveBeenCalled();
    expect(screen.getByTestId("connected")).toHaveTextContent("false");
    expect(localStorage.getItem("ap_walletSession")).toBeNull();
  });

  it("surfaces a rejected connection without persisting sensitive data", async () => {
    walletMocks.connectModal.mockRejectedValueOnce({
      code: -1,
      message: "User rejected the request",
    });

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await act(async () => {
      screen.getByText("connect-modal").click();
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("User rejected"),
    );
    expect(localStorage.getItem("ap_walletSession")).toBeNull();
  });
});
