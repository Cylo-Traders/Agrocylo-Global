import type { Product, ProductCategory, ProductDetail, ProductListResponse } from "@/types";
import api, { ApiError } from "../lib/apiClient";
import { formatStroopsForDisplay } from "@/lib/validation";

export interface ProductFilters {
  category?: string;
  location?: string;
  minPrice?: string;
  maxPrice?: string;
  page?: number;
  limit?: number;
}

export function validateProductFilters(filters: {
  category: ProductCategory | "";
  location: string;
  minPrice: string;
  maxPrice: string;
}):
  | { valid: true; sanitized: typeof filters }
  | { valid: false; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = [];
  const minPrice = filters.minPrice.trim();
  const maxPrice = filters.maxPrice.trim();
  if (minPrice && !/^\d+(\.\d+)?$/.test(minPrice)) {
    errors.push({ field: "minPrice", message: "Min price must be a valid number" });
  }
  if (maxPrice && !/^\d+(\.\d+)?$/.test(maxPrice)) {
    errors.push({ field: "maxPrice", message: "Max price must be a valid number" });
  }
  if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
    errors.push({ field: "price", message: "Min price cannot exceed max price" });
  }
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    sanitized: {
      category: filters.category,
      location: filters.location.trim(),
      minPrice,
      maxPrice,
    },
  };
}

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;
  const product = value as Partial<Product>;
  return (
    typeof product.id === "string" &&
    typeof product.name === "string" &&
    (product.description === null || typeof product.description === "string") &&
    (product.imageUrl === null || typeof product.imageUrl === "string") &&
    typeof product.pricePerUnit === "string" &&
    product.amountUnit === "stroops" &&
    typeof product.currency === "string" &&
    typeof product.category === "string" &&
    typeof product.unit === "string" &&
    typeof product.quantity === "number" &&
    (product.location === null || typeof product.location === "string") &&
    typeof product.farmerAddress === "string" &&
    (typeof product.campaignId === "string" || product.campaignId === null) &&
    typeof product.isActive === "boolean" &&
    typeof product.isSellable === "boolean"
  );
}

function validateProductResponse(value: unknown): ProductListResponse {
  const response = value as Partial<ProductListResponse>;
  if (!Array.isArray(response.data) || !response.data.every(isProduct)) {
    throw new ApiError(502, "The product service returned an invalid response");
  }
  if (!response.meta || typeof response.meta.total !== "number") {
    throw new ApiError(502, "The product service returned invalid metadata");
  }
  return value as ProductListResponse;
}

export async function fetchProducts(
  filters: ProductFilters = {},
  signal?: AbortSignal,
): Promise<ProductListResponse> {
  const query = new URLSearchParams();
  if (filters.category) query.set("category", filters.category);
  if (filters.location) query.set("location", filters.location);
  if (filters.minPrice) query.set("minPrice", filters.minPrice);
  if (filters.maxPrice) query.set("maxPrice", filters.maxPrice);
  if (filters.page) query.set("page", String(filters.page));
  if (filters.limit) query.set("limit", String(filters.limit));

  const response = await api.get<ProductListResponse>(`/products?${query}`, { signal });
  return validateProductResponse(response);
}

export async function fetchProduct(id: string, signal?: AbortSignal): Promise<ProductDetail> {
  const response = await api.get<ProductDetail>(`/products/${id}`, { signal });
  if (!isProduct(response)) {
    throw new ApiError(502, "The product service returned an invalid product");
  }
  return response;
}

/** Display a stroop price as XLM. Exact BigInt arithmetic — see validation.ts. */
export function formatPrice(raw: string): string {
  return formatStroopsForDisplay(raw, 4);
}
