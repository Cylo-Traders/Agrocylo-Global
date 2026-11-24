import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarketPage from "./page";

vi.mock("@/hooks/queries/useProducts", () => ({
  useProducts: () => ({ data: undefined, isLoading: false, isFetching: false, error: Object.assign(new Error("Network request failed"), { name: "ApiRequestError", code: "NETWORK_ERROR" }), refetch: vi.fn() }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ useAnalytics: () => ({ trackFilterUsage: vi.fn(), trackSearchQuery: vi.fn(), trackFeatureAdoption: vi.fn() }) }));
vi.mock("@/context/CartContext", () => ({ useCart: () => ({ cart: { groups: [] }, setQuantityForProduct: vi.fn() }) }));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favoriteIds: [], toggleFavorite: vi.fn() }) }));
vi.mock("@/hooks/useWallet", () => ({ useWallet: () => ({ connected: false }) }));
vi.mock("next/image", () => ({ default: (props: any) => <img {...props} /> }));

describe("MarketPage", () => {
  it("shows actionable unreachable message on network error", () => {
    render(<MarketPage />);
    expect(screen.getByText("Can't reach the marketplace right now")).toBeInTheDocument();
    expect(screen.getByText(/marketplace service is unreachable/i)).toBeInTheDocument();
  });
});
