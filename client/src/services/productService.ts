import type {
  Product,
  ProductCategory,
  ProductCurrency,
  ProductUnit,
  ProductWriteInput,
} from "@/types/product";

import { apiRequest } from "@/lib/apiHelper";
import { isTestMode } from "@/lib/testMode";

function productFromJson(json: unknown): Product {
  return json as Product;
}

function demoProducts(): Product[] {
  const now = new Date().toISOString();
  return [
    {
      id: "demo-tomatoes",
      farmer_wallet: "GDEMOFARMER000000000000000000000000000000000000000000",
      name: "Fresh Tomatoes",
      category: "Vegetables",
      price_per_unit: "12.50",
      currency: "USDC",
      unit: "kg",
      stock_quantity: 120,
      description: "Demo listing available when demo mode is enabled.",
      location: "Lagos, NG",
      delivery_window: "2-3 days",
      is_available: true,
      image_url: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "demo-yam",
      farmer_wallet: "GDEMOFARMER000000000000000000000000000000000000000000",
      name: "Yam Tubers",
      category: "Tubers",
      price_per_unit: "8.00",
      currency: "USDC",
      unit: "kg",
      stock_quantity: 80,
      description: "Demo listing available when demo mode is enabled.",
      location: "Ibadan, NG",
      delivery_window: "3-5 days",
      is_available: true,
      image_url: null,
      created_at: now,
      updated_at: now,
    },
  ];
}

function filterDemoProducts(params: ListProductsParams) {
  let items = demoProducts();
  if (params.category) items = items.filter((p) => p.category === params.category);
  if (params.search) {
    const q = params.search.toLowerCase();
    items = items.filter((p) => p.name.toLowerCase().includes(q));
  }
  if (params.priceMin !== undefined) items = items.filter((p) => Number(p.price_per_unit) >= params.priceMin!);
  if (params.priceMax !== undefined) items = items.filter((p) => Number(p.price_per_unit) <= params.priceMax!);
  if (params.sort === "price-asc") items = [...items].sort((a, b) => Number(a.price_per_unit) - Number(b.price_per_unit));
  if (params.sort === "price-desc") items = [...items].sort((a, b) => Number(b.price_per_unit) - Number(a.price_per_unit));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 24;
  return { page, page_size: pageSize, total: items.length, items };
}

function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export type ProductSort =
  "newest" | "price-asc" | "price-desc" | "rating" | "distance" | "popular";

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
  if (isTestMode()) return filterDemoProducts(params);

  const query = toQuery({
    farmer: params.farmer,
    category: params.category,
    categories: params.categories?.length ? params.categories.join(",") : undefined,
    q: params.search,
    page: params.page,
    page_size: params.pageSize,
    include_unavailable: params.includeUnavailable ? true : undefined,
    price_min: params.priceMin,
    price_max: params.priceMax,
    rating_min: params.ratingMin,
    location: params.location,
    in_stock: params.inStockOnly ? true : undefined,
    max_age_days: params.maxAgeDays,
    stock_min: params.stockMin,
    sort: params.sort,
  });

  return await apiRequest<{
    page: number;
    page_size: number;
    items: Product[];
    total?: number;
  }>(`/products${query}`, { method: "GET" });
}

export async function getProductById(
  productId: string,
): Promise<Product | null> {
  if (isTestMode()) return demoProducts().find((p) => p.id === productId) ?? null;
  try {
    const json = await apiRequest<unknown>(`/products/${productId}`, { method: "GET" });
    return productFromJson(json);
  } catch (err) {
    const anyErr = err as { status?: number; message?: string };
    if (anyErr?.status === 404 || /404|not found/i.test(anyErr?.message || "")) return null;
    throw err;
  }
}

export async function createProduct(
  input: ProductWriteInput,
): Promise<Product> {
  // Test mode: return dummy product
  if (isTestMode()) {
    return {
      id: String(Date.now()),
      farmer_wallet: "test-wallet",
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

  const json = await apiRequest<unknown>("/products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
  });

  return productFromJson(json);
}

export async function updateProduct(
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

  const json = await apiRequest<unknown>(`/products/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
  });

  return productFromJson(json);
}

export async function softDeleteProduct(
  productId: string,
): Promise<Product> {
  const json = await apiRequest<unknown>(`/products/${productId}`, {
    method: "DELETE",
  });
  return productFromJson(json);
}

export async function uploadProductImage(
  productId: string,
  file: File,
): Promise<{ image_url: string }> {
  const formData = new FormData();
  formData.append("image", file);

  return apiRequest<{ image_url: string }>(`/products/${productId}/image`, {
    method: "POST",
    body: formData,
  });
}

/** Admin: toggle is_available on any product. */
export async function adminSetProductVisibility(
  productId: string,
  isAvailable: boolean,
): Promise<Product> {
  return apiRequest<Product>(`/admin/products/${productId}/visibility`, {
    method: "PATCH",
    body: { is_available: isAvailable },
  });
}

/** Admin: permanently delist (hard-delete) a product. */
export async function adminDelistProduct(productId: string): Promise<void> {
  await apiRequest<void>(`/admin/products/${productId}`, {
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
  const next = [
    t,
    ...current.filter((x) => x.toLowerCase() !== t.toLowerCase()),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  writeLocal(SEARCH_HISTORY_KEY, next);
  return next;
}

export function clearSearchHistory() {
  writeLocal<string[]>(SEARCH_HISTORY_KEY, []);
}

// ─── Favorites / Wishlist ─────────────────────────────────────────────────

const FAVORITES_KEY = "market:favorites";
const EMPTY_FAVORITES: string[] = Object.freeze([]) as unknown as string[];
let favoriteSnapshot: string[] = EMPTY_FAVORITES;
let favoriteSnapshotRaw: string | null | undefined;

function parseFavoriteIds(raw: string | null): string[] {
  if (!raw) return EMPTY_FAVORITES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((id) => typeof id === "string")
    ) {
      return EMPTY_FAVORITES;
    }
    const unique = [...new Set(parsed)];
    return unique.length
      ? (Object.freeze(unique) as string[])
      : EMPTY_FAVORITES;
  } catch {
    return EMPTY_FAVORITES;
  }
}

export function getFavoriteIds(): string[] {
  if (typeof window === "undefined") return EMPTY_FAVORITES;
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (raw === favoriteSnapshotRaw) return favoriteSnapshot;
    favoriteSnapshotRaw = raw;
    favoriteSnapshot = parseFavoriteIds(raw);
    return favoriteSnapshot;
  } catch {
    favoriteSnapshotRaw = null;
    favoriteSnapshot = EMPTY_FAVORITES;
    return favoriteSnapshot;
  }
}

export function getServerFavoriteIds(): string[] {
  return EMPTY_FAVORITES;
}

function persistFavoriteIds(ids: string[]): void {
  const next = ids.length
    ? (Object.freeze([...ids]) as string[])
    : EMPTY_FAVORITES;
  const raw = JSON.stringify(next);
  favoriteSnapshot = next;
  favoriteSnapshotRaw = raw;
  writeLocal(FAVORITES_KEY, next);
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
  persistFavoriteIds(next);
  return index < 0;
}

export function clearFavorites() {
  persistFavoriteIds([]);
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
  const combined = [...readSearchHistory(), ...FALLBACK_POPULAR_SEARCHES];
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
