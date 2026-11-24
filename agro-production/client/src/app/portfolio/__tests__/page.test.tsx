import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PortfolioPage from "../page";
import { setAccessToken } from "@/lib/authToken";

vi.mock("@/components/PriceChart", () => {
  const Chart = () => <div data-testid="price-chart">Chart</div>;
  return { default: Chart, PriceChart: Chart };
});

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("@/services/portfolioService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/portfolioService")>();
  return { ...actual, fetchInvestorPortfolio: mockGet };
});

function portfolioFixture() {
  return {
    investorAddress: "GBP7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7X",
    totalInvested: "1,234.5678901",
    totalReturned: "0.0000000",
    claimCount: 0,
    positions: [
      {
        id: "pos-1",
        campaignId: "campaign-1",
        campaignName: "Campaign 42",
        amountInvested: "1,234.5678901",
        status: "FUNDING",
        investedAt: new Date().toISOString(),
        claimedReturn: null,
      },
    ],
  };
}

class FakeApiError extends Error {
  status: number;
  constructor(status: number) {
    super("api");
    this.name = "ApiError";
    this.status = status;
  }
}

class FakeNetworkError extends Error {
  constructor() {
    super("network");
    this.name = "NetworkError";
  }
}

describe("PortfolioPage (#1051)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccessToken(null);
  });

  it("renders loading state", () => {
    mockGet.mockImplementation(() => new Promise(() => {}));
    render(<PortfolioPage />);
    expect(screen.getByTestId("price-chart")).toBeInTheDocument();
  });

  it("renders XLM units, not dollar signs", async () => {
    mockGet.mockResolvedValueOnce(portfolioFixture());

    render(<PortfolioPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/XLM/i)[0]).toBeInTheDocument();
    });
    expect(screen.queryAllByText(/\$/).length).toBe(0);
  });

  it("renders exact stroop precision in XLM strings", async () => {
    mockGet.mockResolvedValueOnce(portfolioFixture());

    render(<PortfolioPage />);
    await waitFor(() => {
      expect(screen.getByText("1,234.5678901 XLM")).toBeInTheDocument();
    });
  });

  it("renders empty state when the investor has no positions", async () => {
    mockGet.mockResolvedValueOnce({ ...portfolioFixture(), positions: [] });

    render(<PortfolioPage />);
    await waitFor(() => {
      expect(screen.getByText(/no investments yet/i)).toBeInTheDocument();
    });
  });

  it("renders an actionable unauthorized state on 401", async () => {
    mockGet.mockRejectedValueOnce(new FakeApiError(401));

    render(<PortfolioPage />);
    await waitFor(() => {
      expect(screen.getByText(/wallet connection required/i)).toBeInTheDocument();
    });
  });

  it("renders a retryable offline state on network failure", async () => {
    mockGet.mockRejectedValueOnce(new FakeNetworkError());

    render(<PortfolioPage />);
    await waitFor(() => {
      expect(screen.getByText(/you appear to be offline/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/retry/i)).toBeInTheDocument();
  });

  it("renders a retryable error state on server failure", async () => {
    mockGet.mockRejectedValueOnce(new Error("Failed to fetch portfolio"));

    render(<PortfolioPage />);
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/retry/i)).toBeInTheDocument();
  });
});

// The service contract is what the page depends on; verify its mapping too.
describe("portfolioService mapping (#1051)", () => {
  it("keeps large stroop values exact through BigInt conversion", async () => {
    const { mapInvestorPortfolio } = await import("@/services/portfolioService");

    const summary = mapInvestorPortfolio({
      investorAddress: "GBP7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7X",
      positions: [],
      totalInvested: "10000000000000001",
      totalReturned: "0",
    });

    expect(summary.totalInvested).toBe("1,000,000,000.0000001");
    expect(summary.totalReturned).toBe("0.0000000");
    expect(summary.claimCount).toBe(0);
  });

  it("maps claimed campaign payouts exactly and leaves unclaimed positions null (#1343)", async () => {
    const { mapInvestorPortfolio } = await import("@/services/portfolioService");

    const position = (id: string, campaignId: string) => ({
      id,
      campaignId,
      investorAddress: "GBP7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7X",
      amount: "10000000",
      ledger: 1,
      createdAt: new Date().toISOString(),
    });

    const summary = mapInvestorPortfolio({
      investorAddress: "GBP7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7X",
      positions: [position("p1", "c1"), position("p2", "c2")],
      claims: [
        {
          campaignId: "c1",
          campaignOnChainId: "1",
          payoutAmount: "90071992547409930000001",
          ledger: 5,
          claimedAt: new Date().toISOString(),
        },
      ],
      totalInvested: "20000000",
      totalReturned: "90071992547409930000001",
      returnsSource: "campaign_claims",
    });

    expect(summary.totalReturned).toBe("9,007,199,254,740,993.0000001");
    expect(summary.claimCount).toBe(1);
    expect(summary.positions[0].claimedReturn).toBe("9,007,199,254,740,993.0000001");
    expect(summary.positions[1].claimedReturn).toBeNull();
  });
});
