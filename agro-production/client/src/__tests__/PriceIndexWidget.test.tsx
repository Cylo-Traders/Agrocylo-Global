import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PriceIndexWidget } from "@/components/PriceIndexWidget";
import { fetchPriceIndex, type PriceIndexResponse } from "@/services/priceIndexService";

vi.mock("@/services/priceIndexService", async () => {
  const actual = await vi.importActual<typeof import("@/services/priceIndexService")>(
    "@/services/priceIndexService",
  );
  return { ...actual, fetchPriceIndex: vi.fn() };
});

const mockFetch = vi.mocked(fetchPriceIndex);

function response(computedAt: string): PriceIndexResponse {
  return {
    data: [{
      crop: "White Maize",
      region: "Region-GBFARM",
      averagePrice: 4.5,
      sampleCount: 3,
      computedAt,
    }],
    meta: {
      source: "marketplace",
      currency: "XLM",
      unit: "XLM per product token",
      sampleSemantics: "count of active marketplace product listings in the group",
      regionSource: "linked campaign farmer address prefix, or Global when unlinked",
      computedAt,
    },
  };
}

describe("PriceIndexWidget (#1258)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders loading while the API request is pending", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<PriceIndexWidget />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading price data/i);
  });

  it("renders a distinct empty state without fake benchmark rows", async () => {
    mockFetch.mockResolvedValue({ ...response(new Date().toISOString()), data: [] });
    render(<PriceIndexWidget />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/no marketplace price data/i));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a distinct error state with retry", async () => {
    mockFetch.mockRejectedValue(new Error("API offline"));
    render(<PriceIndexWidget />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/API offline/i));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("renders populated marketplace data", async () => {
    mockFetch.mockResolvedValue(response(new Date().toISOString()));
    render(<PriceIndexWidget />);
    await waitFor(() => expect(screen.getByText("White Maize")).toBeInTheDocument());
    expect(screen.getByText("Region-GBFARM")).toBeInTheDocument();
    expect(screen.queryByText(/may be out of date/i)).not.toBeInTheDocument();
  });

  it("labels old computed data as stale instead of current", async () => {
    mockFetch.mockResolvedValue(response("2020-01-01T00:00:00.000Z"));
    render(<PriceIndexWidget />);
    await waitFor(() => expect(screen.getByText(/may be out of date/i)).toBeInTheDocument());
    expect(screen.getByText("White Maize")).toBeInTheDocument();
  });
});
