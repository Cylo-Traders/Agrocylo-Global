"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { WalletContext } from "./WalletContext";
import type { CartState } from "@/types/cart";
import { getActiveCart, addItemToCart, updateCartItemQuantity, removeCartItem, clearCart } from "@/services/cartService";

type CartContextType = {
  cart: CartState;
  cartLoading: boolean;
  cartError: string | null;

  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;

  itemCount: number;
  refreshCart: () => Promise<void>;

  setQuantityForProduct: (productId: string, quantity: number) => void;
  removeCartItem: (itemId: string) => Promise<void>;
  clearCart: () => Promise<void>;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const wallet = useContext(WalletContext);
  const { address, connected } = wallet;

  const [cart, setCart] = useState<CartState>({ cart_id: null, groups: [] });
  const [cartLoading, setCartLoading] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const itemCount = useMemo(() => {
    return cart.groups.reduce((acc, g) => {
      return acc + g.items.reduce((a, it) => a + Number(it.quantity), 0);
    }, 0);
  }, [cart]);

  const refreshCart = useCallback(async () => {
    if (!address || !connected) return;
    setCartLoading(true);
    setCartError(null);
    try {
      const next = await getActiveCart(address);
      setCart(next);
    } catch (err) {
      setCartError(err instanceof Error ? err.message : "Failed to load cart.");
    } finally {
      setCartLoading(false);
    }
  }, [address, connected]);

  useEffect(() => {
    if (!connected || !address) return;
    void refreshCart();
  }, [connected, address, refreshCart]);

  const findItemByProductId = useCallback(
    (productId: string) => {
      for (const g of cart.groups) {
        const it = g.items.find((x) => x.product_id === productId);
        if (it) return { itemId: it.id, quantity: Number(it.quantity), group: g };
      }
      return null;
    },
    [cart.groups],
  );

  const setQuantityForProduct = useCallback(
    (productId: string, quantity: number) => {
      if (!address || !connected) return;
      const nextQty = Math.max(0, Math.floor(quantity));
      if (nextQty === 0) {
        const existing = findItemByProductId(productId);
        if (existing) {
          const { itemId } = existing;
          // Immediate delete (no debounce) to match expected UI behavior.
          void (async () => {
            try {
              if (timersRef.current[itemId]) {
                clearTimeout(timersRef.current[itemId]);
                delete timersRef.current[itemId];
              }
              const updated = await removeCartItem(address, itemId);
              setCart(updated);
            } catch (err) {
              setCartError(err instanceof Error ? err.message : "Failed to remove item.");
              void refreshCart();
            }
          })();
        }
        return;
      }

      const existing = findItemByProductId(productId);
      if (!existing) {
        void (async () => {
          try {
            const updated = await addItemToCart(address, productId, nextQty);
            setCart(updated);
          } catch (err) {
            setCartError(err instanceof Error ? err.message : "Failed to add item.");
          }
        })();
        return;
      }

      const { itemId } = existing;

      // Optimistic UI update.
      setCart((prev) => ({
        ...prev,
        groups: prev.groups.map((g) => ({
          ...g,
          items: g.items.map((it) =>
            it.id === itemId ? { ...it, quantity: String(nextQty) } : it,
          ),
        })),
      }));

      // Debounced backend update.
      if (timersRef.current[itemId]) clearTimeout(timersRef.current[itemId]);
      timersRef.current[itemId] = setTimeout(() => {
        void (async () => {
          try {
            const updated = await updateCartItemQuantity(address, itemId, nextQty);
            setCart(updated);
          } catch (err) {
            setCartError(err instanceof Error ? err.message : "Failed to update cart item.");
            void refreshCart();
          } finally {
            delete timersRef.current[itemId];
          }
        })();
      }, 500);
    },
    [address, connected, findItemByProductId, refreshCart],
  );

  const removeCartItemFn = useCallback(
    async (itemId: string) => {
      if (!address) return;
      if (timersRef.current[itemId]) {
        clearTimeout(timersRef.current[itemId]);
        delete timersRef.current[itemId];
      }
      const updated = await removeCartItem(address, itemId);
      setCart(updated);
    },
    [address],
  );

  const clearCartFn = useCallback(async () => {
    if (!address) return;
    const updated = await clearCart(address);
    setCart(updated);
  }, [address]);

  const ctx: CartContextType = {
    cart,
    cartLoading,
    cartError,
    drawerOpen,
    setDrawerOpen,
    itemCount,
    refreshCart,
    setQuantityForProduct,
    removeCartItem: removeCartItemFn,
    clearCart: clearCartFn,
  };

  return <CartContext.Provider value={ctx}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

