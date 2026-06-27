import type { Product, ProductDetail, ProductListResponse } from "@/types";
import api from "../lib/apiClient";

export interface ProductFilters {
  category?: string;
  campaignId?: string;
  isActive?: boolean;
  priceMin?: string;
  priceMax?: string;
  page?: number;
  limit?: number;
}

export async function fetchProducts(
  filters: ProductFilters = {},
): Promise<ProductListResponse> {
  const query = new URLSearchParams();
  if (filters.category) query.set("category", filters.category);
  if (filters.campaignId) query.set("campaignId", filters.campaignId);
  if (filters.isActive !== undefined) query.set("isActive", String(filters.isActive));
  if (filters.priceMin) query.set("priceMin", filters.priceMin);
  if (filters.priceMax) query.set("priceMax", filters.priceMax);
  if (filters.page) query.set("page", String(filters.page));
  if (filters.limit) query.set("limit", String(filters.limit));

  return api.get<ProductListResponse>(`/products?${query}`);
}

export async function fetchProduct(id: string): Promise<ProductDetail> {
  return api.get<ProductDetail>(`/products/${id}`);
}

export function formatPrice(raw: string): string {
  const n = BigInt(raw || "0");
  const xlm = Number(n) / 1e7;
  return xlm.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
