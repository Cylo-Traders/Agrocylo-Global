"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Heart, RefreshCw, Search, WifiOff } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site.config";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useCart } from "@/context/CartContext";
import { useProducts } from "@/hooks/queries/useProducts";
import { useFavorites } from "@/hooks/useFavorites";
import { useWallet } from "@/hooks/useWallet";
import type { ProductCategory } from "@/types/product";

const CATEGORIES: Array<ProductCategory | "All"> = [
  "All",
  "Vegetables",
  "Fruits",
  "Grains",
  "Tubers",
  "Livestock",
  "Other",
];

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
      <div className="relative">
        <div className="absolute inset-0 size-full">
          <Image
            src="/images/market-hero.avif"
            alt="Fresh produce at a farmers market"
            fill
            priority
            sizes="100vw"
            className="size-full object-cover object-center"
            unoptimized
          />
        </div>
        <div className="from-background/90 via-background/85 to-background/25 relative bg-gradient-to-r pt-40 pb-16 sm:py-44 md:py-56">
          <Wrapper>
            <h1 className="text-foreground max-w-[805px] text-3xl leading-[1.2] font-semibold sm:text-4xl md:text-5xl lg:text-[56px]">
              Discover and Trade Fresh Farm Produce on{" "}
              <span className="text-primary">{siteConfig.title}</span>.
            </h1>
            <p className="mt-3 max-w-[700px] text-base font-normal md:text-lg">
              Browse listings from farmers around the world. Every order is secured by
              Stellar escrow until you confirm delivery.
            </p>
          </Wrapper>
        </div>
      </div>

      <Wrapper className="-mt-8 md:-mt-12">
        <div className="bg-card relative z-10 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by product name..."
                className="pl-10"
              />
            </div>

            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
              aria-label="Sort by"
            >
              <option value="newest">Newest first</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
            </select>

            <div className="flex items-center gap-1 text-sm">
              <Input
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="Min price"
                className="w-24"
                type="number"
                min={0}
                aria-label="Minimum price"
              />
              <span className="text-muted-foreground">-</span>
              <Input
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="Max price"
                className="w-24"
                type="number"
                min={0}
                aria-label="Maximum price"
              />
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto md:flex-wrap">
            {CATEGORIES.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className="inline-flex min-h-11 cursor-pointer items-center"
              >
                <Badge variant={category === item ? "default" : "outline"} className="px-3 py-2 text-xs">
                  {item}
                </Badge>
              </button>
            ))}

            <button
              onClick={() => setShowFavoritesOnly((v) => !v)}
              className="inline-flex min-h-11 cursor-pointer items-center"
            >
              <Badge
                variant={showFavoritesOnly ? "default" : "outline"}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              >
                <Heart
                  className={cn(
                    "size-3",
                    showFavoritesOnly && "fill-background",
                  )}
                />
                Favorites
                {favoriteIds.length > 0 && (
                  <span className="ml-0.5">({favoriteIds.length})</span>
                )}
              </Badge>
            </button>
          </div>
        </div>
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
                  <article
                    key={product.id}
                    className="bg-card group flex flex-col overflow-hidden rounded-2xl border transition hover:shadow-md"
                  >
                    <Link
                      href={`/market/${product.id}`}
                      className="relative aspect-[4/3] overflow-hidden bg-secondary"
                    >
                      {product.image_url ? (
                        <Image
                          src={product.image_url}
                          alt={product.name}
                          fill
                          sizes="(max-width: 768px) 100vw, 33vw"
                          className="object-cover transition group-hover:scale-105"
                        />
                      ) : (
                        <div className="grid size-full place-content-center text-5xl">
                          🌱
                        </div>
                      )}
                      <Badge className="absolute left-3 top-3" variant="secondary">
                        {product.category}
                      </Badge>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavorite(product.id);
                        }}
                        className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-background/60 backdrop-blur-sm transition-colors hover:bg-background/80"
                        aria-label={
                          favoriteIds.includes(product.id)
                            ? "Remove from favorites"
                            : "Add to favorites"
                        }
                      >
                        <Heart
                          className={cn(
                            "size-4",
                            favoriteIds.includes(product.id)
                              ? "fill-destructive text-destructive"
                              : "text-muted-foreground",
                          )}
                        />
                      </button>
                    </Link>

                    <div className="flex flex-1 flex-col gap-3 p-5">
                      <div>
                        <Link
                          href={`/market/${product.id}`}
                          className="font-semibold hover:text-primary"
                        >
                          {product.name}
                        </Link>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {product.location}
                        </p>
                      </div>

                      <div className="flex items-baseline justify-between">
                        <p className="text-lg font-bold">
                          {product.price_per_unit}{" "}
                          <span className="text-muted-foreground text-sm font-medium">
                            {product.currency} / {product.unit}
                          </span>
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {product.stock_quantity ?? "Unlimited"} in stock
                        </p>
                      </div>

                      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                        {currentQty > 0 ? (
                          <div className="bg-secondary flex items-center gap-1 rounded-full p-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-11 rounded-full"
                              disabled={!connected}
                              onClick={() => setQuantityForProduct(product.id, currentQty - 1)}
                            >
                              -
                            </Button>
                            <span className="min-w-6 text-center text-sm font-medium">
                              {currentQty}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-11 rounded-full"
                              disabled={!connected}
                              onClick={() => setQuantityForProduct(product.id, currentQty + 1)}
                            >
                              +
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            disabled={!connected}
                            onClick={() => setQuantityForProduct(product.id, 1)}
                            className="flex-1"
                          >
                            {connected ? "Add to cart" : "Connect to buy"}
                          </Button>
                        )}

                        <Link
                          href={`/market/${product.id}`}
                          className="text-muted-foreground hover:text-foreground text-xs font-medium"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </Wrapper>
    </div>
  );
}
