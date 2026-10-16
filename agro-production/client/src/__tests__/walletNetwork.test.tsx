import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveWalletSession } from "@/lib/walletSession";
import {
  EXPECTED_NETWORK_PASSPHRASE,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
} from "@/lib/stellarNetwork";

/**
 * WalletContext network state machine (#1087): the wallet's reported network
 * must surface as match / mismatch / unknown / checking — an unverifiable
 * network is never a match — and `useWalletNetworkGuard` must block financial
 * actions on the two bad states.
 */

const networkMocks = vi.hoisted(() => ({
  freighterGetNetwork: vi.fn(),
  xbullGetNetwork: vi.fn(),
  freighterGetPublicKey: vi.fn(),
  xbullGetPublicKey: vi.fn(),
  connectModal: vi.fn(),
  disconnect: vi.fn(),
  refresh: vi.fn(),
  initialize: vi.fn(),
}));

vi.mock("@/lib/wallets/registry", () => {
  const adapters = [
    {
      id: "freighter",
      name: "Freighter",
      iconUrl: "freighter.png",
      installUrl: "https://freighter.app",
      moduleType: "HOT_WALLET",
      platforms: ["browser"],
      supportsDeepLink: false,
      isAvailable: async () => true,
      getPublicKey: networkMocks.freighterGetPublicKey,
      getNetwork: networkMocks.freighterGetNetwork,
      signTransaction: vi.fn(),
      disconnect: networkMocks.disconnect,
    },
    {
      id: "xbull",
      name: "xBull",
      iconUrl: "xbull.png",
      installUrl: "https://xbull.app",
      moduleType: "HOT_WALLET",
      platforms: ["browser", "mobile"],
      supportsDeepLink: true,
      isAvailable: async () => true,
      getPublicKey: networkMocks.xbullGetPublicKey,
      getNetwork: networkMocks.xbullGetNetwork,
      signTransaction: vi.fn(),
      disconnect: networkMocks.disconnect,
    },
  ];
  return {
    DEFAULT_WALLET_ID: "freighter",
    WALLET_ADAPTERS: adapters,
    getWalletAdapter: (id?: string) =>
      adapters.find((adapter) => adapter.id === id) ?? adapters[0],
    connectWithWalletModal: networkMocks.connectModal,
    disconnectWallet: networkMocks.disconnect,
    initializeWalletKit: networkMocks.initialize,
    refreshWalletAvailability: networkMocks.refresh,
  };
});

import { WalletProvider, useWallet } from "@/context/WalletContext";
import { useWalletNetworkGuard } from "@/hooks/useWalletNetworkGuard";

/** A passphrase that is deliberately not the configured one. */
const WRONG_PASSPHRASE =
  EXPECTED_NETWORK_PASSPHRASE === MAINNET_PASSPHRASE
    ? TESTNET_PASSPHRASE
    : MAINNET_PASSPHRASE;

function NetworkConsumer() {
  const {
    connected,
    networkPassphrase,
    networkStatus,
    networkMismatch,
    networkUnknown,
    walletState,
    connect,
    disconnect,
  } = useWallet();
  const guard = useWalletNetworkGuard();

  return (
    <div>
      <span data-testid="connected">{String(connected)}</span>
      <span data-testid="status">{networkStatus}</span>
      <span data-testid="wallet-state">{walletState}</span>
      <span data-testid="passphrase">{networkPassphrase ?? "null"}</span>
      <span data-testid="mismatch">{String(networkMismatch)}</span>
      <span data-testid="unknown">{String(networkUnknown)}</span>
      <span data-testid="guard-blocked">{String(guard.blocked)}</span>
      <span data-testid="guard-reason">{guard.reason ?? "-"}</span>
      <button onClick={() => void connect("freighter")}>connect-freighter</button>
      <button onClick={() => void connect("xbull")}>connect-xbull</button>
      <button onClick={() => void disconnect()}>disconnect</button>
    </div>
  );
}

function renderWallet() {
  return render(
    <WalletProvider>
      <NetworkConsumer />
    </WalletProvider>,
  );
}

async function click(text: string) {
  await act(async () => {
    screen.getByText(text).click();
  });
}

function expectStatus(status: string) {
  expect(screen.getByTestId("status")).toHaveTextContent(status);
}

describe("WalletProvider network reporting (#1087)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    networkMocks.refresh.mockResolvedValue([
      { id: "freighter", available: true },
      { id: "xbull", available: true },
    ]);
    networkMocks.connectModal.mockResolvedValue({
      address: "GMODALADDRESS",
      walletId: "xbull",
    });
    networkMocks.freighterGetPublicKey.mockResolvedValue("GFREIGHTER");
    networkMocks.xbullGetPublicKey.mockResolvedValue("GXULL");
    networkMocks.freighterGetNetwork.mockResolvedValue({
      networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
    });
    networkMocks.xbullGetNetwork.mockResolvedValue({
      networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
    });
  });

  it("reports match, connected and an unblocked guard for the configured network", async () => {
    renderWallet();
    await click("connect-freighter");

    await waitFor(() => expectStatus("match"));
    expect(screen.getByTestId("connected")).toHaveTextContent("true");
    expect(screen.getByTestId("wallet-state")).toHaveTextContent("connected");
    expect(screen.getByTestId("passphrase")).toHaveTextContent(
      EXPECTED_NETWORK_PASSPHRASE,
    );
    expect(screen.getByTestId("mismatch")).toHaveTextContent("false");
    expect(screen.getByTestId("unknown")).toHaveTextContent("false");
    expect(screen.getByTestId("guard-blocked")).toHaveTextContent("false");
  });

  it("holds the checking state until the wallet answers, then settles", async () => {
    let release: (value: { networkPassphrase: string | null }) => void = () => {};
    networkMocks.freighterGetNetwork.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWallet();
    await click("connect-freighter");

    await waitFor(() =>
      expect(screen.getByTestId("connected")).toHaveTextContent("true"),
    );
    expectStatus("checking");
    expect(screen.getByTestId("wallet-state")).toHaveTextContent("connected");
    expect(screen.getByTestId("guard-blocked")).toHaveTextContent("false");

    await act(async () => {
      release({ networkPassphrase: EXPECTED_NETWORK_PASSPHRASE });
    });
    await waitFor(() => expectStatus("match"));
  });

  it("reports a known wrong network as mismatch and blocks the guard", async () => {
    networkMocks.freighterGetNetwork.mockResolvedValue({
      networkPassphrase: WRONG_PASSPHRASE,
    });

    renderWallet();
    await click("connect-freighter");

    await waitFor(() => expectStatus("mismatch"));
    expect(screen.getByTestId("wallet-state")).toHaveTextContent("wrong_network");
    expect(screen.getByTestId("passphrase")).toHaveTextContent(WRONG_PASSPHRASE);
    expect(screen.getByTestId("mismatch")).toHaveTextContent("true");
    expect(screen.getByTestId("unknown")).toHaveTextContent("false");
    expect(screen.getByTestId("guard-blocked")).toHaveTextContent("true");
    expect(screen.getByTestId("guard-reason")).toHaveTextContent(
      "Switch your wallet's network",
    );
  });

  it("reports an unverifiable network as unknown — never as a match", async () => {
    networkMocks.freighterGetNetwork.mockResolvedValue(null);

    renderWallet();
    await click("connect-freighter");

    await waitFor(() => expectStatus("unknown"));
    expect(screen.getByTestId("wallet-state")).toHaveTextContent("unknown_network");
    expect(screen.getByTestId("passphrase")).toHaveTextContent("null");
    expect(screen.getByTestId("mismatch")).toHaveTextContent("false");
    expect(screen.getByTestId("unknown")).toHaveTextContent("true");
    expect(screen.getByTestId("guard-blocked")).toHaveTextContent("true");
    expect(screen.getByTestId("guard-reason")).toHaveTextContent(
      "did not report which network",
    );
  });

  it("treats a throwing getNetwork as unknown", async () => {
    networkMocks.freighterGetNetwork.mockRejectedValue(new Error("boom"));

    renderWallet();
    await click("connect-freighter");

    await waitFor(() => expectStatus("unknown"));
    expect(screen.getByTestId("passphrase")).toHaveTextContent("null");
  });

  it("drops the previous wallet's report when the user switches wallets", async () => {
    renderWallet();
    await click("connect-freighter");
    await waitFor(() => expectStatus("match"));

    // The second wallet has not answered yet: the status must go back to
    // `checking`, not keep believing the first wallet's matching report.
    let release: (value: { networkPassphrase: string | null }) => void = () => {};
    networkMocks.xbullGetNetwork.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    await click("connect-xbull");
    await waitFor(() =>
      expect(screen.getByTestId("passphrase")).toHaveTextContent("null"),
    );
    expectStatus("checking");

    await act(async () => {
      release({ networkPassphrase: WRONG_PASSPHRASE });
    });
    await waitFor(() => expectStatus("mismatch"));
    expect(screen.getByTestId("passphrase")).toHaveTextContent(WRONG_PASSPHRASE);
    expect(screen.getByTestId("wallet-state")).toHaveTextContent("wrong_network");
  });

  it("reconnects a persisted session and verifies its network", async () => {
    saveWalletSession({
      address: "GSAVED",
      connectedAt: Date.now(),
      walletId: "freighter",
    });
    networkMocks.freighterGetNetwork.mockResolvedValue({
      networkPassphrase: WRONG_PASSPHRASE,
    });

    renderWallet();

    await waitFor(() => expectStatus("mismatch"));
    expect(networkMocks.freighterGetPublicKey).toHaveBeenCalledWith({
      silent: true,
    });
    expect(screen.getByTestId("connected")).toHaveTextContent("true");
    expect(screen.getByTestId("guard-blocked")).toHaveTextContent("true");
  });

  it("clears the network state on disconnect", async () => {
    renderWallet();
    await click("connect-freighter");
    await waitFor(() => expectStatus("match"));

    await click("disconnect");

    await waitFor(() => expectStatus("disconnected"));
    expect(screen.getByTestId("connected")).toHaveTextContent("false");
    expect(screen.getByTestId("wallet-state")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("passphrase")).toHaveTextContent("null");
    expect(screen.getByTestId("guard-blocked")).toHaveTextContent("false");
  });
});
