import type { CartState } from "@/types/cart";
import { apiRequest } from "@/lib/apiHelper";

export async function getActiveCart(walletAddress: string): Promise<CartState> {
  void walletAddress;
  return apiRequest<CartState>("/cart", {
    method: "GET",
  });
}

export async function addItemToCart(
  walletAddress: string,
  productId: string,
  quantity: number,
): Promise<CartState> {
  return apiRequest<CartState>("/cart/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      product_id: productId,
      quantity: String(quantity),
    },
  });
}

export async function updateCartItemQuantity(
  walletAddress: string,
  itemId: string,
  quantity: number,
): Promise<CartState> {
  return apiRequest<CartState>(`/cart/items/${itemId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      quantity: String(quantity),
    },
  });
}

export async function removeCartItem(
  walletAddress: string,
  itemId: string,
): Promise<CartState> {
  return apiRequest<CartState>(`/cart/items/${itemId}`, {
    method: "DELETE",
  });
}

export async function clearCart(walletAddress: string): Promise<CartState> {
  void walletAddress;
  return apiRequest<CartState>("/cart", {
    method: "DELETE",
  });
}
