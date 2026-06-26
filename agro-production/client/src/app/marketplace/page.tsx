"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchProducts, validateProductFilters, isNetworkError } from "@/services/productService";
import { ProductCardSkeleton } from "@/components/Skeletons";
import { MarketplaceFilters } from "@/components/MarketplaceFilters";
import { ProductCard } from "@/components/ProductCard";
import type { Product, ProductCategory } from "@/types";

export default function MarketplacePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ProductCategory | "">("");
  const [location, setLocation] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [filterErrors, setFilterErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const validation = validateProductFilters({
      category,
      location,
      minPrice,
      maxPrice,
    });
    if (!validation.valid) {
      setFilterErrors(validation.errors.map((e) => e.message));
      setLoading(false);
      return;
    }
    setFilterErrors([]);
    const sanitized = validation.sanitized;
    try {
      const res = await fetchProducts({
        category: sanitized.category || undefined,
        location: sanitized.location || undefined,
        minPrice: sanitized.minPrice || undefined,
        maxPrice: sanitized.maxPrice || undefined,
      });
      setProducts(res.data);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Network error — check your connection and try again"
          : err instanceof Error
            ? err.message
            : "Failed to load products"
      );
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [category, location, minPrice, maxPrice]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Marketplace</h1>
        <p className="text-muted text-sm mt-1">
          Buy fresh produce directly from verified farmers.
        </p>
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
      {loading ? (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          aria-label="Loading products"
          aria-busy="true"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-16" role="alert">
          <p className="text-red-600 text-sm mb-3">{error}</p>
          <button
            onClick={() => void load()}
            className="text-sm text-primary-600 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <p className="text-lg mb-1">No products found</p>
          <p className="text-sm">Try adjusting your filters.</p>
        </div>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          aria-label="Products list"
        >
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
