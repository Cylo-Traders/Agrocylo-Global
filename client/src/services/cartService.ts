import type { CartState } from "@/types/cart";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000";

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

export async function getActiveCart(walletAddress: string): Promise<CartState> {
  return requestJson<CartState>(`${API_BASE_URL}/cart`, {
    method: "GET",
    headers: {
      "x-wallet-address": walletAddress,
    },
  });
}

export async function addItemToCart(
  walletAddress: string,
  productId: string,
  quantity: number,
): Promise<CartState> {
  return requestJson<CartState>(`${API_BASE_URL}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify({
      product_id: productId,
      quantity: String(quantity),
    }),
  });
}

export async function updateCartItemQuantity(
  walletAddress: string,
  itemId: string,
  quantity: number,
): Promise<CartState> {
  return requestJson<CartState>(`${API_BASE_URL}/cart/items/${itemId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify({
      quantity: String(quantity),
    }),
  });
}

export async function removeCartItem(
  walletAddress: string,
  itemId: string,
): Promise<CartState> {
  return requestJson<CartState>(`${API_BASE_URL}/cart/items/${itemId}`, {
    method: "DELETE",
    headers: {
      "x-wallet-address": walletAddress,
    },
  });
}

export async function clearCart(walletAddress: string): Promise<CartState> {
  return requestJson<CartState>(`${API_BASE_URL}/cart`, {
    method: "DELETE",
    headers: {
      "x-wallet-address": walletAddress,
    },
  });
}

