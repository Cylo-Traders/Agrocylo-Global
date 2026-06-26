import type {
  Product,
  ProductCategory,
  ProductCurrency,
  ProductUnit,
  ProductWriteInput,
} from "@/types/product";

import { API_BASE_URL } from "@/lib/apiConfig";
import { isTestMode } from "@/lib/testMode";

function productFromJson(json: unknown): Product {
  return json as Product;
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message || body?.title || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export type ProductSort =
  | "newest"
  | "price-asc"
  | "price-desc"
  | "rating"
  | "distance"
  | "popular";

export type ListProductsParams = {
  farmer?: string;
  category?: string;
  categories?: string[];
  search?: string;
  page?: number;
  pageSize?: number;
  includeUnavailable?: boolean;
  // Advanced filters
  priceMin?: number;
  priceMax?: number;
  ratingMin?: number;
  location?: string;
  inStockOnly?: boolean;
  maxAgeDays?: number;
  stockMin?: number;
  sort?: ProductSort;
};

export async function listProducts(params: ListProductsParams = {}) {
  const url = new URL(`${API_BASE_URL}/products`);
  if (params.farmer) url.searchParams.set("farmer", params.farmer);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.categories && params.categories.length > 0) {
    url.searchParams.set("categories", params.categories.join(","));
  }
  if (params.search) url.searchParams.set("q", params.search);
  if (params.page) url.searchParams.set("page", String(params.page));
  if (params.pageSize)
    url.searchParams.set("page_size", String(params.pageSize));
  if (params.includeUnavailable)
    url.searchParams.set("include_unavailable", "true");
  if (params.priceMin !== undefined)
    url.searchParams.set("price_min", String(params.priceMin));
  if (params.priceMax !== undefined)
    url.searchParams.set("price_max", String(params.priceMax));
  if (params.ratingMin !== undefined)
    url.searchParams.set("rating_min", String(params.ratingMin));
  if (params.location) url.searchParams.set("location", params.location);
  if (params.inStockOnly) url.searchParams.set("in_stock", "true");
  if (params.maxAgeDays !== undefined)
    url.searchParams.set("max_age_days", String(params.maxAgeDays));
  if (params.stockMin !== undefined)
    url.searchParams.set("stock_min", String(params.stockMin));
  if (params.sort) url.searchParams.set("sort", params.sort);

  return await requestJson<{
    page: number;
    page_size: number;
    items: Product[];
    total?: number;
  }>(url);
}

export async function getProductById(productId: string): Promise<Product | null> {
  try {
    const json = await requestJson<unknown>(`${API_BASE_URL}/products/${productId}`);
    return productFromJson(json);
  } catch (err) {
    if (err instanceof Error && /404|not found/i.test(err.message)) return null;
    throw err;
  }
}

export async function createProduct(
  walletAddress: string,
  input: ProductWriteInput,
): Promise<Product> {
  // Test mode: return dummy product
  if (isTestMode()) {
    return {
      id: String(Date.now()),
      farmer_wallet: walletAddress,
      name: input.name ?? "Test Product",
      category: input.category ?? "Other",
      price_per_unit: input.price_per_unit ?? "0",
      currency: input.currency ?? "USDC",
      unit: input.unit ?? "kg",
      stock_quantity: input.stock_quantity ?? null,
      description: input.description ?? "",
      location: input.location ?? "Test Location",
      delivery_window: input.delivery_window ?? "Test Window",
      is_available: input.is_available ?? true,
      image_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const payload = {
    ...input,
    // Backend expects these field names.
    price_per_unit: input.price_per_unit,
    stock_quantity: input.stock_quantity ?? null,
  };

  const json = await requestJson<unknown>(`${API_BASE_URL}/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify(payload),
  });

  return productFromJson(json);
}

export async function updateProduct(
  walletAddress: string,
  productId: string,
  input: ProductWriteInput,
): Promise<Product> {
  const payload: Record<string, unknown> = { ...input };

  // Ensure correct keys + null handling
  if ("stock_quantity" in payload && payload.stock_quantity === "")
    payload.stock_quantity = null;

  // Backend updateProduct uses `price_per_unit` (not `pricePerUnit`)
  if ("price_per_unit" in payload) {
    // leave as-is
  }

  const json = await requestJson<unknown>(`${API_BASE_URL}/products/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify(payload),
  });

  return productFromJson(json);
}

export async function softDeleteProduct(
  walletAddress: string,
  productId: string,
): Promise<Product> {
  const json = await requestJson<unknown>(`${API_BASE_URL}/products/${productId}`, {
    method: "DELETE",
    headers: {
      "x-wallet-address": walletAddress,
    },
  });
  return productFromJson(json);
}

export async function uploadProductImage(
  walletAddress: string,
  productId: string,
  file: File,
): Promise<{ image_url: string }> {
  const formData = new FormData();
  formData.append("image", file);

  const res = await fetch(`${API_BASE_URL}/products/${productId}/image`, {
    method: "POST",
    headers: {
      "x-wallet-address": walletAddress,
    },
    body: formData,
  });

  if (!res.ok) {
    let message = `Image upload failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.message || body?.title || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (await res.json()) as { image_url: string };
}

/** Admin: toggle is_available on any product. */
export async function adminSetProductVisibility(
  productId: string,
  isAvailable: boolean,
): Promise<Product> {
  return requestJson<Product>(`${API_BASE_URL}/admin/products/${productId}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_available: isAvailable }),
  });
}

/** Admin: permanently delist (hard-delete) a product. */
export async function adminDelistProduct(productId: string): Promise<void> {
  await requestJson<void>(`${API_BASE_URL}/admin/products/${productId}`, {
    method: "DELETE",
  });
}

export function normalizeProductWriteInput(input: {
  name: string;
  category: ProductCategory | null;
  pricePerUnit: string;
  currency: ProductCurrency;
  unit: ProductUnit;
  stockQuantity: string | null;
  description: string | null;
  location: string; // Add this
  deliveryWindow: string;
  isAvailable: boolean;
}): ProductWriteInput {
  return {
    name: input.name,
    description: input.description,
    category: input.category,
    price_per_unit: input.pricePerUnit,
    currency: input.currency,
    unit: input.unit,
    stock_quantity: input.stockQuantity,
    location: input.location,
    delivery_window: input.deliveryWindow,
    is_available: input.isAvailable,
  };
}

// ─── Saved Searches ────────────────────────────────────────────────────────

export interface SavedSearchPayload {
  search?: string;
  categories?: string[];
  priceMin?: number;
  priceMax?: number;
  ratingMin?: number;
  location?: string;
  inStockOnly?: boolean;
  maxAgeDays?: number;
  stockMin?: number;
  sort?: ProductSort;
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: SavedSearchPayload;
  emailAlerts: boolean;
  pushAlerts: boolean;
  createdAt: string;
}

const SAVED_SEARCHES_KEY = "market:saved-searches";
const SEARCH_HISTORY_KEY = "market:search-history";
const SEARCH_HISTORY_LIMIT = 10;

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage quota / disabled — ignore
  }
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/search/saved`, {
      credentials: "include",
    });
    if (res.ok) return await res.json();
  } catch {
    // fall through to local
  }
  return readLocal<SavedSearch[]>(SAVED_SEARCHES_KEY, []);
}

export async function createSavedSearch(input: {
  name: string;
  filters: SavedSearchPayload;
  emailAlerts?: boolean;
  pushAlerts?: boolean;
}): Promise<SavedSearch> {
  const entry: SavedSearch = {
    id: `ss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name,
    filters: input.filters,
    emailAlerts: input.emailAlerts ?? false,
    pushAlerts: input.pushAlerts ?? true,
    createdAt: new Date().toISOString(),
  };
  try {
    const res = await fetch(`${API_BASE_URL}/search/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(entry),
    });
    if (res.ok) return await res.json();
  } catch {
    // fall through
  }
  const existing = readLocal<SavedSearch[]>(SAVED_SEARCHES_KEY, []);
  writeLocal(SAVED_SEARCHES_KEY, [entry, ...existing]);
  return entry;
}

export async function deleteSavedSearch(id: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/search/saved/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) return;
  } catch {
    // fall through
  }
  const existing = readLocal<SavedSearch[]>(SAVED_SEARCHES_KEY, []);
  writeLocal(
    SAVED_SEARCHES_KEY,
    existing.filter((s) => s.id !== id),
  );
}

export async function updateSavedSearch(
  id: string,
  patch: Partial<Pick<SavedSearch, "name" | "emailAlerts" | "pushAlerts">>,
): Promise<SavedSearch | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/search/saved/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    if (res.ok) return await res.json();
  } catch {
    // fall through
  }
  const existing = readLocal<SavedSearch[]>(SAVED_SEARCHES_KEY, []);
  let updated: SavedSearch | null = null;
  const next = existing.map((s) => {
    if (s.id !== id) return s;
    updated = { ...s, ...patch };
    return updated;
  });
  writeLocal(SAVED_SEARCHES_KEY, next);
  return updated;
}

// ─── Search History ───────────────────────────────────────────────────────

export function readSearchHistory(): string[] {
  return readLocal<string[]>(SEARCH_HISTORY_KEY, []);
}

export function pushSearchHistory(term: string): string[] {
  const t = term.trim();
  if (!t) return readSearchHistory();
  const current = readSearchHistory();
  const next = [t, ...current.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(
    0,
    SEARCH_HISTORY_LIMIT,
  );
  writeLocal(SEARCH_HISTORY_KEY, next);
  return next;
}

export function clearSearchHistory() {
  writeLocal<string[]>(SEARCH_HISTORY_KEY, []);
}

// ─── Favorites / Wishlist ─────────────────────────────────────────────────

const FAVORITES_KEY = "market:favorites";

export function getFavoriteIds(): string[] {
  return readLocal<string[]>(FAVORITES_KEY, []);
}

export function isFavorite(productId: string): boolean {
  return getFavoriteIds().includes(productId);
}

export function toggleFavorite(productId: string): boolean {
  const current = getFavoriteIds();
  const index = current.indexOf(productId);
  let next: string[];
  if (index >= 0) {
    next = current.filter((id) => id !== productId);
  } else {
    next = [productId, ...current];
  }
  writeLocal(FAVORITES_KEY, next);
  return index < 0;
}

export function clearFavorites() {
  writeLocal<string[]>(FAVORITES_KEY, []);
}

// ─── Search Analytics ─────────────────────────────────────────────────────

const FALLBACK_POPULAR_SEARCHES = [
  "tomatoes",
  "rice",
  "cassava",
  "maize",
  "yam",
  "plantain",
  "beans",
  "palm oil",
];

export async function fetchPopularSearches(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/search/popular`, {
      credentials: "include",
    });
    if (res.ok) return await res.json();
  } catch {
    // fall through
  }
  return FALLBACK_POPULAR_SEARCHES;
}

export async function fetchTrendingProducts(): Promise<Product[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/products/trending`, {
      credentials: "include",
    });
    if (res.ok) return await res.json();
  } catch {
    // fall through
  }
  // Best-effort: just return the first page of newest products
  try {
    const first = await listProducts({ pageSize: 6, sort: "newest" });
    return first.items;
  } catch {
    return [];
  }
}

export async function fetchSearchSuggestions(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const url = new URL(`${API_BASE_URL}/search/suggestions`);
    url.searchParams.set("q", q);
    const res = await fetch(url, { credentials: "include" });
    if (res.ok) return await res.json();
  } catch {
    // fall through
  }
  // Local fallback: filter the popular list + history
  const ql = q.toLowerCase();
  const combined = [
    ...readSearchHistory(),
    ...FALLBACK_POPULAR_SEARCHES,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of combined) {
    const tl = term.toLowerCase();
    if (tl.includes(ql) && !seen.has(tl)) {
      seen.add(tl);
      out.push(term);
      if (out.length >= 6) break;
    }
  }
  return out;
}
