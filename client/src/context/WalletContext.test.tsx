import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WalletProvider, WalletContext } from "./WalletContext";
import React, { useContext } from "react";
import type { WalletContextType } from "@/types/wallet";

const mockFreighter = {
  getPublicKey: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
};

vi.mock("@/lib/stellar", () => ({
  getXlmBalance: vi.fn(() => Promise.resolve("100")),
}));

vi.mock("@/lib/signTransaction", () => ({
  signAndSubmitTransaction: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackWalletConnected: vi.fn(),
  trackWalletDisconnected: vi.fn(),
}));

function TestConsumer() {
  const ctx = useContext(WalletContext);
  return (
    <div>
      <span data-testid="connected">{String(ctx.connected)}</span>
      <span data-testid="restoring">{String(ctx.restoring)}</span>
      <span data-testid="address">{ctx.address ?? "null"}</span>
      <span data-testid="error">{ctx.error ?? "null"}</span>
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
    // @ts-ignore
    window.freighter = mockFreighter;
  });

  afterEach(() => {
    localStorage.clear();
    // @ts-ignore
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
  });
});
