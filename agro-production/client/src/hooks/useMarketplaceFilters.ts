'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type MarketplaceSort = 'newest' | 'price-asc' | 'price-desc' | 'popular';

export interface MarketplaceFilters {
  search: string;
  category: string;
  sort: MarketplaceSort;
  minPrice: number | null;
  maxPrice: number | null;
  favoritesOnly: boolean;
}

export const DEFAULT_MARKETPLACE_FILTERS: MarketplaceFilters = {
  search: '',
  category: '',
  sort: 'newest',
  minPrice: null,
  maxPrice: null,
  favoritesOnly: false,
};

const SORT_VALUES: MarketplaceSort[] = ['newest', 'price-asc', 'price-desc', 'popular'];
const SEARCH_DEBOUNCE_MS = 300;

function parsePrice(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseSort(value: string | null): MarketplaceSort {
  if (value && (SORT_VALUES as string[]).includes(value)) {
    return value as MarketplaceSort;
  }
  return DEFAULT_MARKETPLACE_FILTERS.sort;
}

function parseFilters(params: URLSearchParams): MarketplaceFilters {
  const minPrice = parsePrice(params.get('minPrice'));
  const maxPrice = parsePrice(params.get('maxPrice'));
  return {
    search: params.get('q') ?? DEFAULT_MARKETPLACE_FILTERS.search,
    category: params.get('category') ?? DEFAULT_MARKETPLACE_FILTERS.category,
    sort: parseSort(params.get('sort')),
    minPrice,
    maxPrice: minPrice !== null && maxPrice !== null && maxPrice < minPrice ? null : maxPrice,
    favoritesOnly: params.get('favorites') === 'true',
  };
}

function buildSearchParams(filters: MarketplaceFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('q', filters.search.trim());
  if (filters.category) params.set('category', filters.category);
  if (filters.sort !== DEFAULT_MARKETPLACE_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.minPrice !== null) params.set('minPrice', String(filters.minPrice));
  if (filters.maxPrice !== null) params.set('maxPrice', String(filters.maxPrice));
  if (filters.favoritesOnly) params.set('favorites', 'true');
  return params;
}

export function useMarketplaceFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlFilters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams?.toString() ?? '')),
    [searchParams]
  );

  const [filters, setFilters] = useState<MarketplaceFilters>(urlFilters);
  const [searchInput, setSearchInput] = useState<string>(urlFilters.search);
  const lastWrittenRef = useRef<string>(buildSearchParams(urlFilters).toString());

  // Sync state when the URL changes via back/forward navigation.
  useEffect(() => {
    const next = buildSearchParams(urlFilters).toString();
    if (next === lastWrittenRef.current) return;
    lastWrittenRef.current = next;
    setFilters(urlFilters);
    setSearchInput(urlFilters.search);
  }, [urlFilters]);

  const writeUrl = useCallback(
    (next: MarketplaceFilters, mode: 'push' | 'replace') => {
      const params = buildSearchParams(next);
      const query = params.toString();
      lastWrittenRef.current = query;
      const href = query ? `${pathname}?${query}` : pathname;
      if (mode === 'replace') {
        router.replace(href, { scroll: false });
      } else {
        router.push(href, { scroll: false });
      }
    },
    [pathname, router]
  );

  // Debounce search typing before writing to the URL (replace, no history spam).
  useEffect(() => {
    if (searchInput === filters.search) return;
    const timer = setTimeout(() => {
      setFilters((prev) => {
        const next = { ...prev, search: searchInput };
        writeUrl(next, 'replace');
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, filters.search, writeUrl]);

  const updateFilters = useCallback(
    (patch: Partial<MarketplaceFilters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        if (patch.search !== undefined) setSearchInput(next.search);
        writeUrl(next, 'push');
        return next;
      });
    },
    [writeUrl]
  );

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_MARKETPLACE_FILTERS);
    setSearchInput(DEFAULT_MARKETPLACE_FILTERS.search);
    writeUrl(DEFAULT_MARKETPLACE_FILTERS, 'push');
  }, [writeUrl]);

  return {
    filters,
    searchInput,
    setSearchInput,
    updateFilters,
    resetFilters,
  };
}
