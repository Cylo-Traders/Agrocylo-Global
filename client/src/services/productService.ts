import type {
  Product,
  ProductCategory,
  ProductCurrency,
  ProductUnit,
  ProductWriteInput,
} from "@/types/product";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000";

function productFromJson(json: any): Product {
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

export type ListProductsParams = {
  farmer?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  includeUnavailable?: boolean;
};

export async function listProducts(params: ListProductsParams = {}) {
  const url = new URL(`${API_BASE_URL}/products`);
  if (params.farmer) url.searchParams.set("farmer", params.farmer);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.page) url.searchParams.set("page", String(params.page));
  if (params.pageSize)
    url.searchParams.set("page_size", String(params.pageSize));
  if (params.includeUnavailable)
    url.searchParams.set("include_unavailable", "true");

  return await requestJson<{
    page: number;
    page_size: number;
    items: Product[];
  }>(url);
}

export async function createProduct(
  walletAddress: string,
  input: ProductWriteInput,
): Promise<Product> {
  const payload = {
    ...input,
    // Backend expects these field names.
    price_per_unit: input.price_per_unit,
    stock_quantity: input.stock_quantity ?? null,
  };

  const json = await requestJson<any>(`${API_BASE_URL}/products`, {
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

  const json = await requestJson<any>(`${API_BASE_URL}/products/${productId}`, {
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
  const json = await requestJson<any>(`${API_BASE_URL}/products/${productId}`, {
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
