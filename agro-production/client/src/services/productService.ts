import type { Product, ProductListResponse, ProductCategory } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export interface ProductFilters {
  category?: ProductCategory;
  location?: string;
  minPrice?: string;
  maxPrice?: string;
  page?: number;
  limit?: number;
}

export async function fetchProducts(
  filters: ProductFilters = {},
): Promise<ProductListResponse> {
  const query = new URLSearchParams();
  if (filters.category) query.set("category", filters.category);
  if (filters.location) query.set("location", filters.location);
  if (filters.minPrice) query.set("minPrice", filters.minPrice);
  if (filters.maxPrice) query.set("maxPrice", filters.maxPrice);
  if (filters.page) query.set("page", String(filters.page));
  if (filters.limit) query.set("limit", String(filters.limit));

  const res = await fetch(`${API_BASE}/products?${query}`);
  if (!res.ok) throw new Error(`Failed to fetch products: ${res.status}`);
  return res.json();
}

export async function fetchProduct(id: string): Promise<Product> {
  const res = await fetch(`${API_BASE}/products/${id}`);
  if (!res.ok) throw new Error(`Product not found: ${res.status}`);
  return res.json();
}

export function formatPrice(raw: string): string {
  const n = BigInt(raw || "0");
  const xlm = Number(n) / 1e7;
  return xlm.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
