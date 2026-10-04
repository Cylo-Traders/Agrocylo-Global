"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { Button } from "@/components/ui/button";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useCart } from "@/context/CartContext";
import { useProducts } from "@/hooks/queries/useProducts";
import { useFavorites } from "@/hooks/useFavorites";
import { useWallet } from "@/hooks/useWallet";
import type { ProductCategory } from "@/types/product";
import { MarketHero } from "./components/MarketHero";
import { MarketFilters } from "./components/MarketFilters";
import { ProductCard } from "./components/ProductCard";

type SortKey = "newest" | "price-asc" | "price-desc";

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : "";
  return /failed to fetch|network|fetch failed/i.test(message);
}

export default function MarketPage() {
  const { connected } = useWallet();
  const { cart, setQuantityForProduct } = useCart();
  const { trackFilterUsage, trackSearchQuery, trackFeatureAdoption } = useAnalytics();
  const { favoriteIds, toggleFavorite } = useFavorites();

  const [category, setCategory] = useState<ProductCategory | "All">("All");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const queryParams = useMemo(
    () => ({
      page: 1,
      pageSize: 24,
      search: search.trim() || undefined,
      category: category === "All" ? undefined : category,
      priceMin: minPrice.trim() ? Number(minPrice) : undefined,
      priceMax: maxPrice.trim() ? Number(maxPrice) : undefined,
      sort: sortKey,
      includeUnavailable: false,
    }),
    [category, maxPrice, minPrice, search, sortKey],
  );

  const { data, isLoading, error, refetch, isFetching } = useProducts(queryParams);
  let products = data?.items ?? [];
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null;

  if (showFavoritesOnly) {
    products = products.filter((p) => favoriteIds.includes(p.id));
  }

  const quantityByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of cart.groups) {
      for (const item of group.items) {
        map.set(item.product_id, Number(item.quantity));
      }
    }
    return map;
  }, [cart.groups]);

  useEffect(() => {
    trackFilterUsage("market_category", category, { source: "market-page" });
  }, [category, trackFilterUsage]);

  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) return;
    const timer = window.setTimeout(() => {
      trackSearchQuery(trimmed, { source: "market-search" });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [search, trackSearchQuery]);

  useEffect(() => {
    if (connected) {
      trackFeatureAdoption("market_browse_connected");
    }
  }, [connected, trackFeatureAdoption]);

  return (
    <div className="flex flex-col">
      <MarketHero />

      <Wrapper className="-mt-8 md:-mt-12">
        <MarketFilters
          search={search}
          setSearch={setSearch}
          sortKey={sortKey}
          setSortKey={setSortKey}
          minPrice={minPrice}
          setMinPrice={setMinPrice}
          maxPrice={maxPrice}
          setMaxPrice={setMaxPrice}
          category={category}
          setCategory={setCategory}
          showFavoritesOnly={showFavoritesOnly}
          setShowFavoritesOnly={setShowFavoritesOnly}
          favoriteIds={favoriteIds}
        />
      </Wrapper>

      <Wrapper className="my-12 md:my-16">
        {errorMessage ? (
          <div className="bg-card flex flex-col items-center gap-4 rounded-2xl border p-10 text-center">
            <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
              <WifiOff className="size-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">
                {isNetworkError(errorMessage)
                  ? "Can't reach the marketplace right now"
                  : "Couldn't load products"}
              </h3>
              <p className="text-muted-foreground text-sm">
                {isNetworkError(errorMessage)
                  ? "The backend service is unreachable. Check your connection and try again."
                  : errorMessage}
              </p>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} />
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-sm">
                {isLoading
                  ? "Loading products..."
                  : showFavoritesOnly
                    ? `${products.length} favorited product${products.length === 1 ? "" : "s"} found`
                    : `${products.length} product${products.length === 1 ? "" : "s"} found`}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => {
                const currentQty = quantityByProductId.get(product.id) ?? 0;
                return (
                  <ProductCard
                    key={product.id}
                    product={product}
                    isFavorite={favoriteIds.includes(product.id)}
                    toggleFavorite={toggleFavorite}
                    currentQty={currentQty}
                    connected={connected}
                    setQuantityForProduct={setQuantityForProduct}
                  />
                );
              })}
            </div>
          </div>
        )}
      </Wrapper>
    </div>
  );
}
