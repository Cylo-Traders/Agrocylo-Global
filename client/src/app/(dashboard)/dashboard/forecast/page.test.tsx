import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = ({ data }: { data: unknown[] }) => (
      <div data-testid="chart-stub">{Array.isArray(data) ? data.length : 0}</div>
    );
    return Stub;
  },
}));

vi.mock("@/hooks/queries/useProducts", () => ({
  useMyProducts: vi.fn(),
}));

import ForecastDashboardPage from "./page";
import { useMyProducts } from "@/hooks/queries/useProducts";

const mockUseMyProducts = vi.mocked(useMyProducts);
type MyProductsResult = ReturnType<typeof useMyProducts>;

describe("ForecastDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeletons", () => {
    mockUseMyProducts.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as MyProductsResult);

    const { container } = render(<ForecastDashboardPage />);
    expect(screen.getByText("Yield & price forecast")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows sparse empty state when farmer has no products", () => {
    mockUseMyProducts.mockReturnValue({
      data: { items: [] },
      isLoading: false,
    } as unknown as MyProductsResult);

    render(<ForecastDashboardPage />);
    expect(screen.getByText(/Sparse regional data/i)).toBeInTheDocument();
  });

  it("renders charts when product pricing exists", () => {
    mockUseMyProducts.mockReturnValue({
      data: {
        items: [
          {
            id: "p1",
            name: "Maize",
            category: "Grains",
            location: "Rift Valley",
            price_per_unit: "12.5",
            stock_quantity: "100",
          },
        ],
      },
      isLoading: false,
    } as unknown as MyProductsResult);

    render(<ForecastDashboardPage />);
    expect(screen.getByText("Price-index trend")).toBeInTheDocument();
    expect(screen.getByText("Seasonal yield estimates")).toBeInTheDocument();
    expect(screen.getByText("Rift Valley")).toBeInTheDocument();
  });
});
