"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { useWallet } from "@/hooks/useWallet";
import { useProducts } from "@/hooks/queries/useProducts";
import { useCart } from "@/context/CartContext";
import { useSearch } from "@/hooks/useSearch";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site.config";
import { SearchFilters } from "@/components/SearchFilters";
import { ProductGrid } from "@/components/ProductGrid";

const VIEW_MODE_KEY = "market:view-mode";

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : "";
  return /failed to fetch|network|fetch failed/i.test(message);
}

export default function MarketPage() {
  const { connected } = useWallet();
  const { cart, setQuantityForProduct } = useCart();
  const search = useSearch();
  const [view, setView] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid";
    return (window.localStorage.getItem(VIEW_MODE_KEY) as "grid" | "list") ?? "grid";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_MODE_KEY, view);
    }
  }, [view]);

  const { filters, debouncedFilters, setFilters } = search;

  const { data, isLoading, error, refetch, isFetching } = useProducts({
    page: debouncedFilters.page,
    pageSize: debouncedFilters.pageSize,
    search: debouncedFilters.search || undefined,
    categories:
      debouncedFilters.categories.length > 0
        ? debouncedFilters.categories
        : undefined,
    priceMin: debouncedFilters.priceMin,
    priceMax: debouncedFilters.priceMax,
    ratingMin: debouncedFilters.ratingMin,
    location: debouncedFilters.location || undefined,
    inStockOnly: debouncedFilters.inStockOnly || undefined,
    maxAgeDays: debouncedFilters.maxAgeDays,
    stockMin: debouncedFilters.stockMin,
    sort: debouncedFilters.sort,
    includeUnavailable: false,
  });

  const products = data?.items ?? [];

  const quantityByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of cart.groups) {
      for (const it of g.items) {
        map.set(it.product_id, Number(it.quantity));
      }
    }
    return map;
  }, [cart.groups]);

  const renderActions = (p: (typeof products)[number]) => {
    const currentQty = quantityByProductId.get(p.id) ?? 0;
    if (currentQty > 0) {
      return (
        <div className="bg-secondary flex w-fit items-center gap-1 rounded-full p-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-8 rounded-full"
            disabled={!connected}
            onClick={() => setQuantityForProduct(p.id, currentQty - 1)}
          >
            −
          </Button>
          <span className="min-w-6 text-center text-sm font-medium">
            {currentQty}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 rounded-full"
            disabled={!connected}
            onClick={() => setQuantityForProduct(p.id, currentQty + 1)}
          >
            +
          </Button>
        </div>
      );
    }
    return (
      <Button
        size="sm"
        disabled={!connected}
        onClick={() => setQuantityForProduct(p.id, 1)}
        className="w-full sm:w-auto"
      >
        {connected ? "Add to cart" : "Connect to buy"}
      </Button>
    );
  };

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <div className="relative">
        <div className="absolute inset-0 size-full">
          <Image
            src="/images/market-hero.avif"
            alt="Fresh produce at a farmers' market"
            fill
            className="size-full object-cover object-center"
            quality={100}
            priority
            sizes="100vw"
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
              Browse listings from farmers around the world. Every order is
              secured by Stellar escrow until you confirm delivery.
            </p>
          </Wrapper>
        </div>
      </div>

      {/* Search + advanced filters */}
      <Wrapper className="-mt-8 md:-mt-12">
        <div className="bg-card relative z-10 rounded-2xl border p-4 shadow-sm md:p-6">
          <SearchFilters
            filters={filters}
            setFilters={setFilters}
            reset={search.reset}
            activeFilterCount={search.activeFilterCount}
            history={search.history}
            recordSearch={search.recordSearch}
            clearHistory={search.clearHistory}
            saved={search.saved}
            savedLoading={search.savedLoading}
            saveCurrent={search.saveCurrent}
            removeSaved={search.removeSaved}
            toggleAlerts={search.toggleAlerts}
            applySaved={search.applySaved}
          />
        </div>
      </Wrapper>

      {/* Results */}
      <Wrapper className="my-12 md:my-16">
        {error ? (
          <div className="bg-card flex flex-col items-center gap-4 rounded-2xl border p-10 text-center">
            <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
              <WifiOff className="size-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">
                {isNetworkError(error)
                  ? "Can't reach the marketplace right now"
                  : "Couldn't load products"}
              </h3>
              <p className="text-muted-foreground text-sm">
                {isNetworkError(error)
                  ? "The backend service is unreachable. Check your connection and try again."
                  : error instanceof Error
                    ? error.message
                    : "Something went wrong."}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={isFetching ? "size-4 animate-spin" : "size-4"}
              />
              Try again
            </Button>
          </div>
        ) : (
          <ProductGrid
            products={products}
            isLoading={isLoading}
            view={view}
            onViewChange={setView}
            page={filters.page}
            pageSize={filters.pageSize}
            totalKnown={data?.total}
            onPageChange={(p) => setFilters({ page: p })}
            onPageSizeChange={(size) => setFilters({ pageSize: size, page: 1 })}
            renderActions={renderActions}
            emptyMessage="Try adjusting your filters or clearing them to see more products."
          />
        )}
      </Wrapper>
    </div>
  );
}
