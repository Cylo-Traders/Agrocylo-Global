import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WalletProvider, WalletContext } from "./WalletContext";
import React, { useContext } from "react";
import type { WalletContextType } from "@/types/wallet";
import { setAuthSession, setSessionTokens } from "@/lib/authToken";
import { refreshAuthSession } from "@/lib/walletSession";

const mockFreighter = {
  getPublicKey: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
};

vi.mock("@/lib/stellar", () => ({
  getXlmBalance: vi.fn(() => Promise.resolve("100")),
}));

vi.mock("@/lib/stellarTransactions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/stellarTransactions")>();
  return { ...actual, signAndSubmitTransaction: vi.fn() };
});

vi.mock("@/lib/analytics", () => ({
  trackWalletConnected: vi.fn(),
  trackWalletDisconnected: vi.fn(),
}));

vi.mock("@/lib/walletSession", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/walletSession")>();
  return { ...actual, refreshAuthSession: vi.fn() };
});

const mockRefreshAuthSession = vi.mocked(refreshAuthSession);

function makeJwt(expSeconds: number, wallet: string): string {
  const payload = { walletAddress: wallet, exp: expSeconds };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

function TestConsumer() {
  const ctx = useContext(WalletContext);
  return (
    <div>
      <span data-testid="connected">{String(ctx.connected)}</span>
      <span data-testid="restoring">{String(ctx.restoring)}</span>
      <span data-testid="address">{ctx.address ?? "null"}</span>
      <span data-testid="error">{ctx.error ?? "null"}</span>
      <span data-testid="networkMismatch">{String(ctx.networkMismatch)}</span>
      <span data-testid="authenticated">{String(ctx.authenticated)}</span>
    </div>
  );
}

function renderWithProvider() {
  return render(
    React.createElement(WalletProvider, null,
      React.createElement(TestConsumer),
    ),
  );
}

describe("WalletContext — restore flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.freighter = mockFreighter;
  });

  afterEach(() => {
    localStorage.clear();
    delete window.freighter;
  });

  it("does not set connected until wallet adapter verifies the key", async () => {
    mockFreighter.getPublicKey.mockResolvedValue(
      "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    );
    mockFreighter.getNetwork.mockResolvedValue("TESTNET");

    localStorage.setItem("walletAddress", "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37");
    localStorage.setItem("walletNetwork", "TESTNET");
    localStorage.setItem("activeWalletId", "freighter");

    renderWithProvider();

    expect(screen.getByTestId("restoring").textContent).toBe("true");
    expect(screen.getByTestId("connected").textContent).toBe("false");

    await waitFor(() => {
      expect(screen.getByTestId("restoring").textContent).toBe("false");
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("address").textContent).toBe(
        "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      );
    });
  });

  it("clears localStorage when restore verification fails", async () => {
    mockFreighter.getPublicKey.mockRejectedValue(
      new Error("Wallet locked"),
    );
    mockFreighter.getNetwork.mockRejectedValue(
      new Error("Wallet locked"),
    );

    localStorage.setItem("walletAddress", "STALE_ADDR");
    localStorage.setItem("walletNetwork", "TESTNET");
    localStorage.setItem("activeWalletId", "freighter");

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("restoring").textContent).toBe("false");
      expect(screen.getByTestId("connected").textContent).toBe("false");
      expect(screen.getByTestId("address").textContent).toBe("null");
    });

    expect(localStorage.getItem("walletAddress")).toBeNull();
    expect(localStorage.getItem("walletNetwork")).toBeNull();
    expect(localStorage.getItem("activeWalletId")).toBeNull();
  });

  it("shows disconnected state when no cached wallet exists", () => {
    renderWithProvider();

    expect(screen.getByTestId("connected").textContent).toBe("false");
    expect(screen.getByTestId("restoring").textContent).toBe("false");
    expect(screen.getByTestId("address").textContent).toBe("null");
    expect(screen.getByTestId("networkMismatch").textContent).toBe("false");
  });
});

describe("WalletContext — networkMismatch", () => {
  const ADDR = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.freighter = mockFreighter;
    vi.stubEnv("NEXT_PUBLIC_STELLAR_ENV", "mainnet");
    vi.stubEnv(
      "NEXT_PUBLIC_NETWORK_PASSPHRASE",
      "Public Global Stellar Network ; September 2015",
    );
    localStorage.setItem("walletAddress", ADDR);
    localStorage.setItem("activeWalletId", "freighter");
    mockFreighter.getPublicKey.mockResolvedValue(ADDR);
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    delete window.freighter;
  });

  it.each([
    ["Freighter short name", "TESTNET"],
    ["Rabet lowercase", "testnet"],
    ["full testnet passphrase", "Test SDF Network ; September 2015"],
  ])("sets networkMismatch true when the wallet reports %s on a mainnet app", async (_l, net) => {
    mockFreighter.getNetwork.mockResolvedValue(net);
    renderWithProvider();
    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("networkMismatch").textContent).toBe("true");
    });
  });

  it("sets networkMismatch false when the wallet reports PUBLIC on a mainnet app", async () => {
    mockFreighter.getNetwork.mockResolvedValue("PUBLIC");
    renderWithProvider();
    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("networkMismatch").textContent).toBe("false");
    });
  });
});

describe("WalletContext — session restore after reload (#1185)", () => {
  const ADDR = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.freighter = mockFreighter;
    mockFreighter.getPublicKey.mockResolvedValue(ADDR);
    mockFreighter.getNetwork.mockResolvedValue("TESTNET");
    localStorage.setItem("walletAddress", ADDR);
    localStorage.setItem("walletNetwork", "TESTNET");
    localStorage.setItem("activeWalletId", "freighter");
  });

  afterEach(() => {
    localStorage.clear();
    delete window.freighter;
  });

  it("marks the session authenticated when a valid token was persisted", async () => {
    setAuthSession(ADDR, makeJwt(Math.floor(Date.now() / 1000) + 60, ADDR), "refresh");

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("authenticated").textContent).toBe("true");
    });
    expect(mockRefreshAuthSession).not.toHaveBeenCalled();
  });

  it("silently refreshes an expired token for the matching session wallet", async () => {
    setAuthSession(ADDR, makeJwt(Math.floor(Date.now() / 1000) - 60, ADDR), "refresh");
    mockRefreshAuthSession.mockImplementation(async () => {
      setSessionTokens(makeJwt(Math.floor(Date.now() / 1000) + 60, ADDR), "refresh2");
      return "refreshed";
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("authenticated").textContent).toBe("true");
    });
    expect(mockRefreshAuthSession).toHaveBeenCalledTimes(1);
  });

  it("does not adopt a session that belongs to a different wallet", async () => {
    setAuthSession(
      "GDIFFERENT",
      makeJwt(Math.floor(Date.now() / 1000) + 60, "GDIFFERENT"),
      "refresh",
    );

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("restoring").textContent).toBe("false");
    });
    expect(screen.getByTestId("authenticated").textContent).toBe("false");
    expect(mockRefreshAuthSession).not.toHaveBeenCalled();
  });
});
