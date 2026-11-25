import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketPage from "./page";

const mockUseProducts = vi.fn();
const mockRefetch = vi.fn();

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/hooks/queries/useProducts", () => ({
  useProducts: (params: unknown) => mockUseProducts(params),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ connected: false }),
}));

vi.mock("@/context/CartContext", () => ({
  useCart: () => ({
    cart: { groups: [] },
    setQuantityForProduct: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    trackFilterUsage: vi.fn(),
    trackSearchQuery: vi.fn(),
    trackFeatureAdoption: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favoriteIds: [],
    toggleFavorite: vi.fn(),
  }),
}));

describe("MarketPage empty, filtered-empty, loading, and error states (Issue #1418)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Products unavailable' and a working Try again button when an unfiltered response returns zero products", () => {
    mockUseProducts.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mockRefetch,
    });

    render(<MarketPage />);

    expect(
      screen.getByRole("heading", { name: /products unavailable/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reset filters/i }),
    ).not.toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders 'No products match these filters' and resets filters when filtering yields zero products", () => {
    mockUseProducts.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mockRefetch,
    });

    render(<MarketPage />);

    const searchInput = screen.getByPlaceholderText(/search by product name/i);
    fireEvent.change(searchInput, { target: { value: "NonexistentCrop" } });

    expect(
      screen.getByRole("heading", { name: /no products match these filters/i }),
    ).toBeInTheDocument();

    const resetButton = screen.getByRole("button", { name: /reset filters/i });
    fireEvent.click(resetButton);

    expect(searchInput).toHaveValue("");
    expect(
      screen.getByRole("heading", { name: /products unavailable/i }),
    ).toBeInTheDocument();
  });

  it("renders loading status without showing the empty state while loading", () => {
    mockUseProducts.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      error: null,
      refetch: mockRefetch,
    });

    render(<MarketPage />);

    expect(screen.getByText(/loading products\.\.\./i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /products unavailable/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the error card and retries on error", () => {
    mockUseProducts.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error("Server returned 500"),
      refetch: mockRefetch,
    });

    render(<MarketPage />);

    expect(
      screen.getByRole("heading", { name: /couldn't load products/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/server returned 500/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
