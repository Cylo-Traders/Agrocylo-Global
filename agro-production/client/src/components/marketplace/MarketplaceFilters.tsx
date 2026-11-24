'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  parseProductCategory,
} from '@/types';

export const CATEGORIES = PRODUCT_CATEGORIES.map((value) => ({
  value,
  label: PRODUCT_CATEGORY_LABELS[value],
}));

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'name-asc', label: 'Name: A to Z' },
];

const DEFAULT_SORT = 'newest';

function parsePrice(value: string | null): string {
  if (!value) return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : '';
}

export function MarketplaceFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [category, setCategory] = useState(
    () => parseProductCategory(searchParams.get('category'))
  );
  const [sort, setSort] = useState(() => {
    const value = searchParams.get('sort');
    return SORT_OPTIONS.some((option) => option.value === value)
      ? (value as string)
      : DEFAULT_SORT;
  });
  const [minPrice, setMinPrice] = useState(parsePrice(searchParams.get('minPrice')));
  const [maxPrice, setMaxPrice] = useState(parsePrice(searchParams.get('maxPrice')));
  const [favoritesOnly, setFavoritesOnly] = useState(
    searchParams.get('favorites') === 'true'
  );
  const [showFilters, setShowFilters] = useState(false);

  const isFirstRender = useRef(true);

  const updateParams = (updates: Record<string, string | null>, replace = false) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    const query = params.toString();
    const url = query ? `?${query}` : '';
    if (replace) {
      router.replace(url, { scroll: false });
    } else {
      router.push(url, { scroll: false });
    }
  };

  // Debounce search typing; replace history so keystrokes don't stack entries.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      updateParams({ q: search.trim() || null }, true);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleCategoryChange = (value: string) => {
    const next = value === 'all' ? '' : parseProductCategory(value);
    setCategory(next);
    updateParams({ category: next || null });
  };

  const handleSortChange = (value: string) => {
    setSort(value);
    updateParams({ sort: value === DEFAULT_SORT ? null : value });
  };

  const handlePriceBlur = () => {
    updateParams({
      minPrice: minPrice || null,
      maxPrice: maxPrice || null,
    });
  };

  const handleFavoritesChange = (checked: boolean) => {
    setFavoritesOnly(checked);
    updateParams({ favorites: checked ? 'true' : null });
  };

  const handleClear = () => {
    setSearch('');
    setCategory('');
    setSort(DEFAULT_SORT);
    setMinPrice('');
    setMaxPrice('');
    setFavoritesOnly(false);
    router.push('', { scroll: false });
  };

  const hasActiveFilters =
    search !== '' ||
    category !== '' ||
    sort !== DEFAULT_SORT ||
    minPrice !== '' ||
    maxPrice !== '' ||
    favoritesOnly;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search products"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[180px]" aria-label="Sort products">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowFilters((prev) => !prev)}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select value={category || 'all'} onValueChange={handleCategoryChange}>
              <SelectTrigger id="category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Price range</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                placeholder="Min"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                onBlur={handlePriceBlur}
                aria-label="Minimum price"
              />
              <span className="text-muted-foreground">-</span>
              <Input
                type="number"
                min={0}
                placeholder="Max"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                onBlur={handlePriceBlur}
                aria-label="Maximum price"
              />
            </div>
          </div>

          <div className="flex items-end">
            <div className="flex items-center gap-2">
              <Checkbox
                id="favorites"
                checked={favoritesOnly}
                onCheckedChange={(checked) => handleFavoritesChange(checked === true)}
              />
              <Label htmlFor="favorites" className="cursor-pointer">
                Favorites only
              </Label>
            </div>
          </div>

          <div className="flex items-end justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClear}
              disabled={!hasActiveFilters}
            >
              <X className="mr-2 h-4 w-4" />
              Clear filters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
