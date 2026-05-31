"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import type { CartState } from "@/types/cart";
import {
  getActiveCart,
  addItemToCart,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
} from "@/services/cartService";

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
  const { address, connected } = useWallet();

  const [cart, setCart] = useState<CartState>({ cart_id: null, groups: [] });
  const [cartLoading, setCartLoading] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cartRef = useRef(cart);
  useEffect(() => { cartRef.current = cart; }, [cart]);

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

  const setQuantityForProduct = useCallback(
    (productId: string, quantity: number) => {
      if (!address || !connected) return;
      const nextQty = Math.max(0, Math.floor(quantity));

      const findItem = (pid: string) => {
        for (const g of cartRef.current.groups) {
          const it = g.items.find((x) => x.product_id === pid);
          if (it) return { itemId: it.id, quantity: Number(it.quantity), group: g };
        }
        return null;
      };

      if (nextQty === 0) {
        const existing = findItem(productId);
        if (existing) {
          const { itemId } = existing;
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

      const existing = findItem(productId);
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

      setCart((prev) => ({
        ...prev,
        groups: prev.groups.map((g) => ({
          ...g,
          items: g.items.map((it) =>
            it.id === itemId ? { ...it, quantity: String(nextQty) } : it,
          ),
        })),
      }));

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
    [address, connected, refreshCart],
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

  const setDrawerOpenFn = useCallback((open: boolean) => {
    setDrawerOpen(open);
  }, []);

  const ctx = useMemo<CartContextType>(
    () => ({
      cart,
      cartLoading,
      cartError,
      drawerOpen,
      setDrawerOpen: setDrawerOpenFn,
      itemCount,
      refreshCart,
      setQuantityForProduct,
      removeCartItem: removeCartItemFn,
      clearCart: clearCartFn,
    }),
    [
      cart,
      cartLoading,
      cartError,
      drawerOpen,
      setDrawerOpenFn,
      itemCount,
      refreshCart,
      setQuantityForProduct,
      removeCartItemFn,
      clearCartFn,
    ],
  );

  return <CartContext.Provider value={ctx}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
