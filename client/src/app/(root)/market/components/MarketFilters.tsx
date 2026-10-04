"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Heart, Search } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface MarketFiltersProps {
  search: string;
  setSearch: (val: string) => void;
  sortKey: SortKey;
  setSortKey: (val: SortKey) => void;
  minPrice: string;
  setMinPrice: (val: string) => void;
  maxPrice: string;
  setMaxPrice: (val: string) => void;
  category: ProductCategory | "All";
  setCategory: (val: ProductCategory | "All") => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (val: boolean) => void;
  favoriteIds: string[];
}

export function MarketFilters({
  search,
  setSearch,
  sortKey,
  setSortKey,
  minPrice,
  setMinPrice,
  maxPrice,
  setMaxPrice,
  category,
  setCategory,
  showFavoritesOnly,
  setShowFavoritesOnly,
  favoriteIds,
}: MarketFiltersProps) {
  return (
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
  );
}
