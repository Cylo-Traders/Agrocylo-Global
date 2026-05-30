"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  pushSearchHistory,
  readSearchHistory,
  updateSavedSearch,
  type ProductSort,
  type SavedSearch,
  type SavedSearchPayload,
} from "@/services/productService";

export interface SearchFiltersState {
  search: string;
  categories: string[];
  priceMin?: number;
  priceMax?: number;
  ratingMin?: number;
  location: string;
  inStockOnly: boolean;
  maxAgeDays?: number;
  stockMin?: number;
  sort: ProductSort;
  page: number;
  pageSize: number;
}

const DEFAULTS: SearchFiltersState = {
  search: "",
  categories: [],
  priceMin: undefined,
  priceMax: undefined,
  ratingMin: undefined,
  location: "",
  inStockOnly: false,
  maxAgeDays: undefined,
  stockMin: undefined,
  sort: "newest",
  page: 1,
  pageSize: 12,
};

function parseFromParams(params: URLSearchParams): SearchFiltersState {
  const num = (key: string) => {
    const v = params.get(key);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const sortValue = params.get("sort") ?? "newest";
  const validSorts: ProductSort[] = [
    "newest",
    "price-asc",
    "price-desc",
    "rating",
    "distance",
    "popular",
  ];
  return {
    search: params.get("q") ?? "",
    categories: params.get("categories")?.split(",").filter(Boolean) ?? [],
    priceMin: num("price_min"),
    priceMax: num("price_max"),
    ratingMin: num("rating_min"),
    location: params.get("location") ?? "",
    inStockOnly: params.get("in_stock") === "true",
    maxAgeDays: num("max_age_days"),
    stockMin: num("stock_min"),
    sort: validSorts.includes(sortValue as ProductSort)
      ? (sortValue as ProductSort)
      : "newest",
    page: num("page") ?? 1,
    pageSize: num("page_size") ?? 12,
  };
}

function toParams(state: SearchFiltersState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search) params.set("q", state.search);
  if (state.categories.length > 0)
    params.set("categories", state.categories.join(","));
  if (state.priceMin !== undefined)
    params.set("price_min", String(state.priceMin));
  if (state.priceMax !== undefined)
    params.set("price_max", String(state.priceMax));
  if (state.ratingMin !== undefined)
    params.set("rating_min", String(state.ratingMin));
  if (state.location) params.set("location", state.location);
  if (state.inStockOnly) params.set("in_stock", "true");
  if (state.maxAgeDays !== undefined)
    params.set("max_age_days", String(state.maxAgeDays));
  if (state.stockMin !== undefined)
    params.set("stock_min", String(state.stockMin));
  if (state.sort !== "newest") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.pageSize !== DEFAULTS.pageSize)
    params.set("page_size", String(state.pageSize));
  return params;
}

export interface UseSearchResult {
  filters: SearchFiltersState;
  debouncedFilters: SearchFiltersState;
  setFilters: (next: Partial<SearchFiltersState>) => void;
  reset: () => void;
  history: string[];
  recordSearch: () => void;
  clearHistory: () => void;
  saved: SavedSearch[];
  savedLoading: boolean;
  reloadSaved: () => Promise<void>;
  saveCurrent: (
    name: string,
    options?: { emailAlerts?: boolean; pushAlerts?: boolean },
  ) => Promise<SavedSearch>;
  removeSaved: (id: string) => Promise<void>;
  toggleAlerts: (
    id: string,
    channel: "email" | "push",
    value: boolean,
  ) => Promise<void>;
  applySaved: (saved: SavedSearch) => void;
  activeFilterCount: number;
}

const DEBOUNCE_MS = 300;

function statePayload(state: SearchFiltersState): SavedSearchPayload {
  const { search, categories, priceMin, priceMax, ratingMin, location, inStockOnly, maxAgeDays, stockMin, sort } =
    state;
  return {
    search,
    categories,
    priceMin,
    priceMax,
    ratingMin,
    location,
    inStockOnly,
    maxAgeDays,
    stockMin,
    sort,
  };
}

export function useSearch(): UseSearchResult {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFiltersState] = useState<SearchFiltersState>(() =>
    parseFromParams(new URLSearchParams(searchParams.toString())),
  );
  const [debouncedFilters, setDebouncedFilters] =
    useState<SearchFiltersState>(filters);
  const [history, setHistory] = useState<string[]>(() => readSearchHistory());
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);

  // Re-sync from URL when query changes via navigation (e.g. back button).
  // We intentionally only sync on serialized-string change to avoid loops.
  const lastSyncedString = useRef(searchParams.toString());
  useEffect(() => {
    const current = searchParams.toString();
    if (current !== lastSyncedString.current) {
      lastSyncedString.current = current;
      setFiltersState(parseFromParams(new URLSearchParams(current)));
    }
  }, [searchParams]);

  // Persist filters to URL whenever they change.
  useEffect(() => {
    const next = toParams(filters).toString();
    if (next === lastSyncedString.current) return;
    lastSyncedString.current = next;
    const target = next ? `${pathname}?${next}` : pathname;
    router.replace(target, { scroll: false });
  }, [filters, pathname, router]);

  // Debounce for query-driving consumers.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedFilters(filters);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [filters]);

  const setFilters = useCallback((patch: Partial<SearchFiltersState>) => {
    setFiltersState((prev) => {
      const next = { ...prev, ...patch };
      // Any filter change (other than pagination/sort itself) resets to page 1.
      if (!("page" in patch)) {
        next.page = 1;
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFiltersState(DEFAULTS);
  }, []);

  const recordSearch = useCallback(() => {
    if (!filters.search.trim()) return;
    setHistory(pushSearchHistory(filters.search));
  }, [filters.search]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("market:search-history");
    }
  }, []);

  const reloadSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      setSaved(await listSavedSearches());
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadSaved();
  }, [reloadSaved]);

  const saveCurrent = useCallback(
    async (
      name: string,
      options?: { emailAlerts?: boolean; pushAlerts?: boolean },
    ) => {
      const entry = await createSavedSearch({
        name,
        filters: statePayload(filters),
        emailAlerts: options?.emailAlerts,
        pushAlerts: options?.pushAlerts,
      });
      setSaved((prev) => [entry, ...prev]);
      return entry;
    },
    [filters],
  );

  const removeSaved = useCallback(async (id: string) => {
    await deleteSavedSearch(id);
    setSaved((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const toggleAlerts = useCallback(
    async (id: string, channel: "email" | "push", value: boolean) => {
      const patch =
        channel === "email"
          ? { emailAlerts: value }
          : { pushAlerts: value };
      setSaved((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      );
      await updateSavedSearch(id, patch);
    },
    [],
  );

  const applySaved = useCallback((entry: SavedSearch) => {
    setFiltersState({
      ...DEFAULTS,
      ...entry.filters,
      search: entry.filters.search ?? "",
      categories: entry.filters.categories ?? [],
      location: entry.filters.location ?? "",
      inStockOnly: entry.filters.inStockOnly ?? false,
      sort: entry.filters.sort ?? "newest",
      page: 1,
    });
  }, []);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.search) n++;
    if (filters.categories.length > 0) n++;
    if (filters.priceMin !== undefined || filters.priceMax !== undefined) n++;
    if (filters.ratingMin !== undefined) n++;
    if (filters.location) n++;
    if (filters.inStockOnly) n++;
    if (filters.maxAgeDays !== undefined) n++;
    if (filters.stockMin !== undefined) n++;
    if (filters.sort !== "newest") n++;
    return n;
  }, [filters]);

  return {
    filters,
    debouncedFilters,
    setFilters,
    reset,
    history,
    recordSearch,
    clearHistory,
    saved,
    savedLoading,
    reloadSaved,
    saveCurrent,
    removeSaved,
    toggleAlerts,
    applySaved,
    activeFilterCount,
  };
}
