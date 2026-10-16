"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isNetworkError } from "@/lib/apiClient";
import { fetchProducts, validateProductFilters } from "@/services/productService";
import { ProductCardSkeleton } from "@/components/Skeletons";
import { MarketplaceFilters } from "@/components/MarketplaceFilters";
import { ProductCard } from "@/components/ProductCard";
import type { Product, ProductCategory } from "@/types";

type MarketplaceErrorKind = "offline" | "timeout" | "invalid" | "unavailable" | "contract" | "unknown";

function classifyMarketplaceError(error: unknown): { kind: MarketplaceErrorKind; message: string } {
  if (isNetworkError(error)) {
    return error.message.toLowerCase().includes("timed out")
      ? { kind: "timeout", message: "The marketplace took too long to respond." }
      : { kind: "offline", message: "The marketplace is offline. Check your connection." };
  }
  if (error instanceof ApiError) {
    if (error.status === 400) return { kind: "invalid", message: "Those filters are not valid. Reset them and try again." };
    if (error.status >= 500 || error.status === 503) return { kind: "unavailable", message: "The marketplace service is temporarily unavailable." };
    if (error.status === 502) return { kind: "contract", message: "The marketplace returned data we could not safely display." };
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : "Failed to load products." };
}

const defaultFilters = { category: "" as ProductCategory | "", location: "", minPrice: "", maxPrice: "" };

export default function MarketplacePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ kind: MarketplaceErrorKind; message: string } | null>(null);
  const [category, setCategory] = useState<ProductCategory | "">(defaultFilters.category);
  const [location, setLocation] = useState(defaultFilters.location);
  const [minPrice, setMinPrice] = useState(defaultFilters.minPrice);
  const [maxPrice, setMaxPrice] = useState(defaultFilters.maxPrice);
  const [filterErrors, setFilterErrors] = useState<string[]>([]);
  const [serviceVersion, setServiceVersion] = useState<string | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const hasSuccessfulData = useRef(false);

  const load = useCallback(async () => {
    const validation = validateProductFilters({ category, location, minPrice, maxPrice });
    if (!validation.valid) {
      setFilterErrors(validation.errors.map((item) => item.message));
      setError({ kind: "invalid", message: "Correct the highlighted filters." });
      setLoading(false);
      return;
    }

    setFilterErrors([]);
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const currentRequest = ++requestId.current;
    setError(null);
    setRefreshing(hasSuccessfulData.current);
    setLoading(!hasSuccessfulData.current);

    try {
      const response = await fetchProducts(
        {
          category: validation.sanitized.category || undefined,
          location: validation.sanitized.location || undefined,
          minPrice: validation.sanitized.minPrice || undefined,
          maxPrice: validation.sanitized.maxPrice || undefined,
        },
        nextController.signal,
      );
      if (currentRequest !== requestId.current) return;
      setProducts(response.data);
      hasSuccessfulData.current = true;
      setServiceVersion(response.meta.serviceVersion ?? null);
    } catch (caught) {
      if (nextController.signal.aborted || currentRequest !== requestId.current) return;
      setError(classifyMarketplaceError(caught));
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [category, location, minPrice, maxPrice]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => () => controller.current?.abort(), []);

  function resetFilters() {
    setCategory(defaultFilters.category);
    setLocation(defaultFilters.location);
    setMinPrice(defaultFilters.minPrice);
    setMaxPrice(defaultFilters.maxPrice);
    setError(null);
  }

  const statusMessage = loading
    ? "Loading products"
    : refreshing
      ? "Refreshing products"
      : error
        ? error.message
        : products.length === 0
          ? "No products found"
          : `${products.length} products available`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Marketplace</h1>
        <p className="text-muted text-sm mt-1">Buy fresh produce directly from verified farmers.</p>
      </div>
      <MarketplaceFilters
        category={category}
        location={location}
        minPrice={minPrice}
        maxPrice={maxPrice}
        filterErrors={filterErrors}
        onCategoryChange={setCategory}
        onLocationChange={setLocation}
        onMinPriceChange={setMinPrice}
        onMaxPriceChange={setMaxPrice}
        onFilterErrorsClear={() => setFilterErrors([])}
      />
      <div className="text-sm text-muted" role="status" aria-live="polite" aria-atomic="true">
        {statusMessage}{serviceVersion ? ` · ${serviceVersion}` : ""}
      </div>
      {error && products.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 text-amber-900 rounded-lg p-4 text-sm" role="alert">
          <p>{error.message} Showing the last successful results.</p>
          <button onClick={() => void load()} className="mt-2 font-medium underline">Retry</button>
        </div>
      )}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading products" aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => <ProductCardSkeleton key={index} />)}
        </div>
      ) : error && products.length === 0 ? (
        <div className="text-center py-16" role="alert">
          <p className="text-red-600 text-sm mb-3">{error.message}</p>
          <button onClick={() => void load()} className="text-sm text-primary-600 hover:underline">Retry</button>
          <p className="text-xs text-muted mt-3">No private wallet or session data is required to browse.</p>
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <p className="text-lg mb-1">No products found</p>
          <p className="text-sm">Try adjusting your filters.</p>
          <button onClick={resetFilters} className="text-sm text-primary-600 hover:underline mt-3">Reset filters</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Products list">
          {products.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      )}
    </div>
  );
}

export { classifyMarketplaceError };
