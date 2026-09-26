import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PortfolioPage from "../page";
import { setAccessToken } from "@/lib/authToken";

vi.mock("@/components/PriceChart", () => ({
  PriceChart: () => <div data-testid="price-chart">Chart</div>,
}));

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
    positions: [
      {
        id: "pos-1",
        campaignId: "campaign-1",
        campaignName: "Campaign 42",
        amountInvested: "1,234.5678901",
        status: "FUNDING",
        investedAt: new Date().toISOString(),
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
    expect(screen.getByTestId("price-chart")).toBeDefined();
  });

  it("renders XLM units, not dollar signs", async () => {
    mockGet.mockResolvedValueOnce(portfolioFixture());

    render(<PortfolioPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/XLM/i).length).toBeGreaterThan(0);
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
  });
});
