import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvestmentWithCampaign } from "@/services/investmentService";
import type { Order } from "@/types";

/**
 * Role dispatch (#1085) and the claim network guard (#1087).
 *
 * Buyer mode must mount no investor effects — no investment fetch, no
 * WebSocket subscription — which is only safe now that the component is a
 * hook-free dispatcher.
 */

const serviceMocks = vi.hoisted(() => ({
  fetchUserInvestments: vi.fn(),
  claimReturns: vi.fn(),
  fetchOrdersByBuyer: vi.fn(),
}));

vi.mock("@/services/investmentService", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/services/investmentService")
  >();
  return {
    ...actual,
    fetchUserInvestments: serviceMocks.fetchUserInvestments,
    claimReturns: serviceMocks.claimReturns,
  };
});

vi.mock("@/services/orderService", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/services/orderService")
  >();
  return {
    ...actual,
    fetchOrdersByBuyer: serviceMocks.fetchOrdersByBuyer,
  };
});

vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: vi.fn() }));
vi.mock("@/context/WalletContext", () => ({ useWallet: vi.fn() }));

import InvestmentDashboard from "@/components/InvestmentDashboard";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useWallet } from "@/context/WalletContext";
import { TESTNET_PASSPHRASE } from "@/lib/stellarNetwork";

const mockedUseWebSocket = vi.mocked(useWebSocket);
const mockedUseWallet = vi.mocked(useWallet);

type WalletCtx = ReturnType<typeof useWallet>;

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

const SETTLED_INVESTMENT: InvestmentWithCampaign = {
  id: "inv-1",
  campaignId: "camp-1",
  investorAddress: "GINVTEST",
  amount: "50000000",
  ledger: 7,
  createdAt: "2026-01-01T00:00:00.000Z",
  campaign: {
    id: "camp-1",
    onChainId: "camp_1",
    farmerAddress: "GFARMER",
    tokenAddress: "CTOKEN",
    targetAmount: "100000000",
    totalRaised: "50000000",
    totalRevenue: "80000000",
    status: "SETTLED",
    deadline: "2026-12-31T00:00:00.000Z",
  },
};

const MOCK_ORDER: Order = {
  id: "ord-12345678",
  onChainId: "chain-ord-1",
  campaignId: "camp-12345678",
  buyerAddress: "GBUYERTEST",
  amount: "25000000",
  status: "PENDING",
  ledger: 10,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  campaign: {
    farmerAddress: "GFARMER",
    tokenAddress: "CTOKEN",
    onChainId: "camp_1",
  },
};

describe("InvestmentDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseWallet.mockReturnValue(walletCtx());
  });

  it("fetches and renders buyer orders with no investor effects (#1085, #1345)", async () => {
    serviceMocks.fetchOrdersByBuyer.mockResolvedValue([MOCK_ORDER]);

    render(<InvestmentDashboard investorAddress="GBUYERTEST" role="buyer" />);

    expect(screen.getByLabelText("Loading orders")).toBeInTheDocument();

    await waitFor(() =>
      expect(serviceMocks.fetchOrdersByBuyer).toHaveBeenCalledWith("GBUYERTEST"),
    );
    expect(serviceMocks.fetchUserInvestments).not.toHaveBeenCalled();
    expect(mockedUseWebSocket).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.getByLabelText("Orders list")).toBeInTheDocument(),
    );
    expect(screen.getByText("Order #ord-1234")).toBeInTheDocument();
    expect(screen.getByText("Campaign camp_1")).toBeInTheDocument();
    expect(screen.getByText("Total Orders")).toBeInTheDocument();
    expect(screen.getByText("Pending Orders")).toBeInTheDocument();
    expect(screen.getByText("Total Spent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Order" })).toHaveAttribute(
      "href",
      "/orders/ord-12345678",
    );
    expect(screen.getByRole("link", { name: "View Campaign" })).toHaveAttribute(
      "href",
      "/campaigns/camp-12345678",
    );
  });

  it("renders empty state with link to browse campaigns when buyer has no orders (#1345)", async () => {
    serviceMocks.fetchOrdersByBuyer.mockResolvedValue([]);

    render(<InvestmentDashboard investorAddress="GBUYERTEST" role="buyer" />);

    await waitFor(() =>
      expect(
        screen.getByText(/No orders yet. Browse campaigns to get started./i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Browse campaigns" })).toHaveAttribute(
      "href",
      "/campaigns",
    );
  });

  it("renders error state with retry button when order fetch fails (#1345)", async () => {
    serviceMocks.fetchOrdersByBuyer.mockRejectedValueOnce(new Error("Network failed"));

    render(<InvestmentDashboard investorAddress="GBUYERTEST" role="buyer" />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Network failed"),
    );

    serviceMocks.fetchOrdersByBuyer.mockResolvedValueOnce([MOCK_ORDER]);
    await act(async () => {
      screen.getByRole("button", { name: "Try again" }).click();
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Orders list")).toBeInTheDocument(),
    );
  });

  it("fetches and renders the investor dashboard for the investor role", async () => {
    serviceMocks.fetchUserInvestments.mockResolvedValue([]);

    render(<InvestmentDashboard investorAddress="GTESTINVESTOR" />);

    expect(
      screen.getByLabelText("Loading investments"),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(serviceMocks.fetchUserInvestments).toHaveBeenCalledWith(
        "GTESTINVESTOR",
      ),
    );
    expect(mockedUseWebSocket).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByText(/No investments yet/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Total Invested")).toBeInTheDocument();
    expect(screen.getByText("Claimable Returns")).toBeInTheDocument();
  });

  it("renders investment rows and lets a claim succeed", async () => {
    serviceMocks.fetchUserInvestments.mockResolvedValue([SETTLED_INVESTMENT]);
    serviceMocks.claimReturns.mockResolvedValue({ success: true });

    render(<InvestmentDashboard investorAddress="GINVTEST" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("Investments list"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Campaign camp_1")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Claim returns" }).click();
    });

    expect(serviceMocks.claimReturns).toHaveBeenCalledWith(
      "GINVTEST",
      "camp-1",
      "camp_1",
    );
    // A successful claim refreshes the investment list via onInvestmentUpdated.
    await waitFor(() =>
      expect(serviceMocks.fetchUserInvestments).toHaveBeenCalledTimes(2),
    );
  });

  it("blocks the claim button while the wallet network is wrong (#1087)", async () => {
    serviceMocks.fetchUserInvestments.mockResolvedValue([SETTLED_INVESTMENT]);
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

    render(<InvestmentDashboard investorAddress="GINVTEST" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("Investments list"),
      ).toBeInTheDocument(),
    );

    const claimButton = screen.getByRole("button", { name: "Claim returns" });
    expect(claimButton).toBeDisabled();
    expect(claimButton).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Switch your wallet's network",
    );

    await act(async () => {
      claimButton.click();
    });
    expect(serviceMocks.claimReturns).not.toHaveBeenCalled();
  });

  it("survives role transitions on a mounted instance without breaking hooks (#1085)", async () => {
    serviceMocks.fetchUserInvestments.mockResolvedValue([]);
    serviceMocks.fetchOrdersByBuyer.mockResolvedValue([MOCK_ORDER]);

    const { rerender } = render(
      <InvestmentDashboard investorAddress="GTESTINVESTOR" role="investor" />,
    );
    await waitFor(() =>
      expect(serviceMocks.fetchUserInvestments).toHaveBeenCalledTimes(1),
    );

    rerender(
      <InvestmentDashboard investorAddress="GTESTINVESTOR" role="buyer" />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Orders list")).toBeInTheDocument(),
    );
    expect(serviceMocks.fetchUserInvestments).toHaveBeenCalledTimes(1);

    rerender(
      <InvestmentDashboard investorAddress="GTESTINVESTOR" role="investor" />,
    );
    await waitFor(() =>
      expect(serviceMocks.fetchUserInvestments).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByText(/No investments yet/i),
    ).toBeInTheDocument();
    expect(mockedUseWebSocket).toHaveBeenCalled();
  });
});
