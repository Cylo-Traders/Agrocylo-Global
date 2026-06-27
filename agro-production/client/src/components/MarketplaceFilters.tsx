"use client";

import { useCallback } from "react";
import { sanitizeString } from "@/lib/validation";
import type { ProductCategory } from "@/types";

const CATEGORIES: { label: string; value: ProductCategory | "" }[] = [
  { label: "All Categories", value: "" },
  { label: "Grains", value: "GRAINS" },
  { label: "Vegetables", value: "VEGETABLES" },
  { label: "Fruits", value: "FRUITS" },
  { label: "Livestock", value: "LIVESTOCK" },
  { label: "Dairy", value: "DAIRY" },
  { label: "Other", value: "OTHER" },
];

interface MarketplaceFiltersProps {
  category: string;
  location: string;
  minPrice: string;
  maxPrice: string;
  filterErrors: string[];
  onCategoryChange: (category: ProductCategory | "") => void;
  onLocationChange: (location: string) => void;
  onMinPriceChange: (price: string) => void;
  onMaxPriceChange: (price: string) => void;
  onFilterErrorsClear: () => void;
}

export function MarketplaceFilters({
  category,
  location,
  minPrice,
  maxPrice,
  filterErrors,
  onCategoryChange,
  onLocationChange,
  onMinPriceChange,
  onMaxPriceChange,
  onFilterErrorsClear,
}: MarketplaceFiltersProps) {
  const handleCategoryChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onCategoryChange(e.target.value as ProductCategory | "");
      onFilterErrorsClear();
    },
    [onCategoryChange, onFilterErrorsClear]
  );

  const handleLocationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onLocationChange(sanitizeString(e.target.value));
    },
    [onLocationChange]
  );

  return (
    <section
      aria-label="Filter products"
      className="bg-surface border border-border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
    >
      <div>
        <label htmlFor="filter-category" className="block text-xs font-medium text-muted mb-1">
          Category
        </label>
        <select
          id="filter-category"
          value={category}
          onChange={handleCategoryChange}
          className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="filter-location" className="block text-xs font-medium text-muted mb-1">
          Location
        </label>
        <input
          id="filter-location"
          type="text"
          value={location}
          onChange={handleLocationChange}
          placeholder="e.g. Lagos, Kano"
          className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted"
        />
      </div>
      <div>
        <label htmlFor="filter-min-price" className="block text-xs font-medium text-muted mb-1">
          Min price (XLM)
        </label>
        <input
          id="filter-min-price"
          type="number"
          value={minPrice}
          onChange={(e) => onMinPriceChange(e.target.value)}
          min="0"
          placeholder="0"
          aria-invalid={filterErrors.some((e) => e.includes("Min"))}
          className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted"
        />
      </div>
      <div>
        <label htmlFor="filter-max-price" className="block text-xs font-medium text-muted mb-1">
          Max price (XLM)
        </label>
        <input
          id="filter-max-price"
          type="number"
          value={maxPrice}
          onChange={(e) => onMaxPriceChange(e.target.value)}
          min="0"
          placeholder="Any"
          aria-invalid={filterErrors.some((e) => e.includes("Max"))}
          className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted"
        />
      </div>
      {filterErrors.length > 0 && (
        <div className="col-span-full" role="alert">
          {filterErrors.map((err, i) => (
            <p key={i} className="text-xs text-error">
              {err}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
