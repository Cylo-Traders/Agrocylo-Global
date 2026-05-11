"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { RefreshCw, WifiOff } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { useWallet } from "@/hooks/useWallet";
import { useProducts } from "@/hooks/queries/useProducts";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { siteConfig } from "@/config/site.config";
import type { ProductCategory } from "@/types/product";

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : "";
  return /failed to fetch|network|fetch failed/i.test(message);
}

const CATEGORIES: Array<ProductCategory | "All"> = [
  "All",
  "Vegetables",
  "Fruits",
  "Grains",
  "Tubers",
  "Livestock",
  "Other",
];

export default function MarketPage() {
  const { connected } = useWallet();
  const { cart, setQuantityForProduct } = useCart();
  const [category, setCategory] = useState<ProductCategory | "All">("All");
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useProducts({
    pageSize: 50,
    category: category === "All" ? undefined : category,
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

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

      {/* Search + filter */}
      <Wrapper className="-mt-8 md:-mt-12">
        <div className="bg-card relative z-10 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm md:flex-row md:items-center md:gap-4 md:p-6">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by product name…"
              className="pl-10"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto md:flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className="cursor-pointer"
              >
                <Badge
                  variant={category === c ? "default" : "outline"}
                  className="px-3 py-1 text-xs"
                >
                  {c}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      </Wrapper>

      {/* Product grid */}
      <Wrapper className="my-12 md:my-16">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-card flex flex-col gap-3 rounded-2xl border p-4"
              >
                <Skeleton className="h-48 w-full rounded-xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : error ? (
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
        ) : filtered.length === 0 ? (
          <div className="bg-card rounded-2xl border p-10 text-center">
            <h3 className="text-lg font-semibold">No products yet</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Try adjusting your search or category filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => {
              const currentQty = quantityByProductId.get(p.id) ?? 0;
              return (
                <article
                  key={p.id}
                  className="bg-card group flex flex-col overflow-hidden rounded-2xl border transition hover:shadow-md"
                >
                  <Link
                    href={`/market/${p.id}`}
                    className="relative aspect-[4/3] overflow-hidden bg-secondary"
                  >
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image_url}
                        alt={p.name}
                        className="size-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid size-full place-content-center text-5xl">
                        🌱
                      </div>
                    )}
                    <Badge className="absolute left-3 top-3" variant="secondary">
                      {p.category}
                    </Badge>
                  </Link>

                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div>
                      <Link
                        href={`/market/${p.id}`}
                        className="font-semibold hover:text-primary"
                      >
                        {p.name}
                      </Link>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {p.location}
                      </p>
                    </div>

                    <div className="flex items-baseline justify-between">
                      <p className="text-lg font-bold">
                        {p.price_per_unit}{" "}
                        <span className="text-muted-foreground text-sm font-medium">
                          {p.currency} / {p.unit}
                        </span>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {p.stock_quantity ?? "Unlimited"} in stock
                      </p>
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      {currentQty > 0 ? (
                        <div className="bg-secondary flex items-center gap-1 rounded-full p-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 rounded-full"
                            disabled={!connected}
                            onClick={() =>
                              setQuantityForProduct(p.id, currentQty - 1)
                            }
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
                            onClick={() =>
                              setQuantityForProduct(p.id, currentQty + 1)
                            }
                          >
                            +
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!connected}
                          onClick={() => setQuantityForProduct(p.id, 1)}
                          className="flex-1"
                        >
                          {connected ? "Add to cart" : "Connect to buy"}
                        </Button>
                      )}
                      <Link
                        href={`/market/${p.id}`}
                        className="text-muted-foreground hover:text-foreground text-xs font-medium"
                      >
                        View →
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Wrapper>
    </div>
  );
}
