import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OrderDetailsPage from "./page";
import { WalletContext } from "@/context/WalletContext";
import type { WalletContextType } from "@/types/wallet";
import React from "react";

const mockTxError = vi.fn(() => null);
const mockConfirmReceipt = vi.fn();
const mockRequestRefund = vi.fn();
const mockOpenDispute = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ orderId: "order-123" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useEscrowContract", () => ({
  useEscrowContract: () => ({
    tx: {
      isLoading: false,
      get error() { return mockTxError(); },
      clearError: vi.fn(),
      activeAction: null,
      confirm: mockConfirmReceipt,
      refund: mockRequestRefund,
      dispute: mockOpenDispute,
    },
    confirmState: { isLoading: false, error: null },
    refundState: { isLoading: false, error: null },
    disputeState: { isLoading: false, error: null },
    confirmReceipt: mockConfirmReceipt,
    requestRefund: mockRequestRefund,
    openDispute: mockOpenDispute,
  }),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "GD5DJQJ7P5DLYX6LXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2",
    connected: true,
  }),
}));

vi.mock("@/hooks/useSocket", () => ({
  useSocket: () => ({ on: vi.fn(() => vi.fn()) }),
}));

vi.mock("@/services/stellar/contractService", () => ({
  getOrder: vi.fn(() =>
    Promise.resolve({
      success: true,
      data: {
        orderId: "order-123",
        buyer: "GD5DJQJ7P5DLYX6LXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2",
        seller: "GC4KJ7P5DLYX6LXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ3",
        amount: "10000000",
        status: "Pending",
        createdAt: Math.floor(Date.now() / 1000),
      },
    }),
  ),
}));

vi.mock("@/lib/helpers/format-address", () => ({
  formatTruncatedAddress: (addr: string) => addr.slice(0, 6) + "...",
}));

const mockWallet: WalletContextType = {
  address: "GD5DJQJ7P5DLYX6LXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2",
  balance: "100",
  connected: true,
  loading: false,
  restoring: false,
  error: null,
  network: "TESTNET",
  activeWalletId: "freighter",
  connect: vi.fn(),
  disconnect: vi.fn(),
  refreshBalance: vi.fn(),
  signAndSubmit: vi.fn(),
};

function renderPage() {
  return render(
    React.createElement(
      WalletContext.Provider,
      { value: mockWallet },
      React.createElement(OrderDetailsPage),
    ),
  );
}

describe("OrderDetailsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxError.mockReturnValue(null);
    mockConfirmReceipt.mockResolvedValue({ success: true, txHash: "TX_HASH" });
    mockRequestRefund.mockResolvedValue({ success: true, txHash: "TX_HASH" });
    mockOpenDispute.mockResolvedValue({ success: true });
  });

  it("renders the order page with action buttons", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Confirm Receipt")).toBeInTheDocument();
    });
  }, 15000);

  it("calls confirm when Confirm Receipt button is clicked", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Confirm Receipt")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Confirm Receipt"));

    await waitFor(() => {
      expect(mockConfirmReceipt).toHaveBeenCalledWith("order-123");
    });
  }, 15000);

  it("displays error when confirm fails", async () => {
    mockTxError.mockReturnValue("Transaction rejected");
    mockConfirmReceipt.mockRejectedValue(new Error("Transaction rejected"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Confirm Receipt")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Confirm Receipt"));

    await waitFor(() => {
      expect(
        screen.getByText("Transaction rejected"),
      ).toBeInTheDocument();
    });
  }, 15000);
});
