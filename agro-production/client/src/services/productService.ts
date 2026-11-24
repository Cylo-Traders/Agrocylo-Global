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

export interface CreateProductInput {
  name: string;
  description?: string;
  imageUrl?: string;
  pricePerUnit: string;
  category: ProductCategory;
  unit: string;
  quantity: number;
  location?: string;
}

/**
 * Farmer-facing message for a failed create-product request. Maps the opaque
 * browser  (network/CORS/timeout) and server errors to an
 * actionable message so the form can surface it without leaking the raw
 * exception. Entered values are preserved by the caller.
 */
export function describeCreateProductError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.status === 408 || error.status === 504) {
      return "We couldn't reach the product service. Check your connection and try again.";
    }
    if (error.status === 401 || error.status === 403) {
      return "Your wallet session expired. Reconnect your wallet and try again.";
    }
    if (error.status >= 500) {
      return "The product service is temporarily unavailable. Please try again shortly.";
    }
    return error.message || "We couldn't create your product. Please try again.";
  }
  if (error instanceof TypeError || (error instanceof Error && /failed to fetch|networkerror/i.test(error.message))) {
    return "We couldn't reach the product service. This may be a network or CORS issue — check your connection and try again.";
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "The request timed out. Please try again.";
  }
  return "We couldn't create your product. Please try again.";
}

export const VALID_PRODUCT_CATEGORIES: readonly ProductCategory[] = [
  "GRAINS",
  "VEGETABLES",
  "FRUITS",
  "LIVESTOCK",
  "DAIRY",
  "OTHER",
] as const;

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  GRAINS: "Grains",
  VEGETABLES: "Vegetables",
  FRUITS: "Fruits",
  LIVESTOCK: "Livestock",
  DAIRY: "Dairy",
  OTHER: "Other",
};

export function formatProductCategory(category: ProductCategory | string | null | undefined): string {
  if (!category) return "";
  const trimmed = category.trim();
  const normalized = trimmed.toUpperCase() as ProductCategory;
  return PRODUCT_CATEGORY_LABELS[normalized] || trimmed;
}

export function parseProductCategory(value: string | null | undefined): ProductCategory | "" {
  if (!value) return "";
  const val = value.trim().toLowerCase();
  if (val === "meat" || val === "poultry") return "LIVESTOCK";
  const upper = val.toUpperCase() as ProductCategory;
  return VALID_PRODUCT_CATEGORIES.includes(upper) ? upper : "";
}

export function validateProductFilters(filters: {
  category: ProductCategory | "" | string;
  location: string;
  minPrice: string;
  maxPrice: string;
}):
  | { valid: true; sanitized: { category: ProductCategory | ""; location: string; minPrice: string; maxPrice: string } }
  | { valid: false; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = [];
  const minPrice = filters.minPrice.trim();
  const maxPrice = filters.maxPrice.trim();
  const rawCategory = (filters.category || "").trim();

  let sanitizedCategory: ProductCategory | "" = "";
  if (rawCategory !== "") {
    const normalized = rawCategory.toUpperCase() as ProductCategory;
    if (VALID_PRODUCT_CATEGORIES.includes(normalized)) {
      sanitizedCategory = normalized;
    } else {
      errors.push({
        field: "category",
        message: `Invalid category "${rawCategory}". Allowed categories are: ${VALID_PRODUCT_CATEGORIES.join(", ")}`,
      });
    }
  }

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
      category: sanitizedCategory,
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

/**
 * An image already attached to a saved listing. `id` is the server-side image
 * identifier used for deletion; `url` is what the farmer sees in the form.
 */
export interface ExistingProductImage {
  id: string;
  url: string;
}

/**
 * Load the image set currently attached to a listing so the edit form can
 * review, reorder, replace, and remove existing photos. Returns an empty list
 * when the listing has no images yet.
 */
export async function fetchProductImages(
  productId: string,
  signal?: AbortSignal,
): Promise<ExistingProductImage[]> {
  const response = await api.get<{ images?: unknown }>(`/products/${productId}/images`, { signal });
  const images = response?.images;
  if (!Array.isArray(images)) return [];
  return images.filter(
    (image): image is ExistingProductImage =>
      !!image &&
      typeof image === "object" &&
      typeof (image as ExistingProductImage).id === "string" &&
      typeof (image as ExistingProductImage).url === "string",
  );
}

/**
 * Remove a single image from a saved listing. The server deletes by image id;
 * callers should only invoke this after the farmer confirms the edit so that
 * cancelling leaves the persisted listing untouched.
 */
export async function deleteProductImage(
  productId: string,
  imageId: string,
): Promise<void> {
  await api.delete<void>(`/products/${productId}/images/${imageId}`);
}

/** Display a stroop price as XLM. Exact BigInt arithmetic — see validation.ts. */
export function formatPrice(raw: string): string {
  return formatStroopsForDisplay(raw, 4);
}
