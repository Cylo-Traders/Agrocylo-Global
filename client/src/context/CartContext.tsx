"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

  // Consistency helpers
  hasPendingUpdates: boolean;
  pendingCount: number;
  flushPendingUpdates: () => Promise<void>;
  getConfirmedCart: () => Promise<CartState | null>;
};

const CartContext = createContext<CartContextType | null>(null);

function toMinorUnits(value: string): bigint {
  const DECIMALS = 7;
  const [intPart = "0", fracPart = ""] = value.split(".");
  const frac = fracPart.padEnd(DECIMALS, "0").slice(0, DECIMALS);
  const intVal = intPart === "" || intPart === "-" ? "0" : intPart;
  // Handle negative? quantities are non-negative
  return BigInt(intVal) * BigInt(10 ** DECIMALS) + BigInt(frac || "0");
}

function computeGroupSubtotal(items: Array<{ quantity: string; unit_price: string }>): string {
  let total = BigInt(0);
  for (const it of items) {
    const q = toMinorUnits(it.quantity);
    const p = toMinorUnits(it.unit_price);
    const line = (q * p) / BigInt(10 ** 7);
    total += line;
  }
  return total.toString();
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { address, connected, authenticated } = useWallet();

  const [cart, setCart] = useState<CartState>({ cart_id: null, groups: [] });
  const [cartLoading, setCartLoading] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cartRef = useRef(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const walletGenerationRef = useRef(0);
  const operationGenerationRef = useRef(0);
  const pendingOpsRef = useRef(0);
  const pendingDesiredRef = useRef<Map<string, number>>(new Map());
  const inFlightUpdateRef = useRef<Map<string, boolean>>(new Map());
  const pendingAddsRef = useRef<Map<string, { desiredQty: number; inFlight: boolean }>>(new Map());
  const pendingPromisesRef = useRef<Set<Promise<unknown>>>(new Set());

  const hasPendingUpdates = pendingCount > 0 || Object.keys(timersRef.current).length > 0;

  const updatePendingCount = useCallback((delta: number) => {
    pendingOpsRef.current += delta;
    if (pendingOpsRef.current < 0) pendingOpsRef.current = 0;
    setPendingCount(pendingOpsRef.current);
  }, []);

  const walletKey = connected && address ? address : null;

  const itemCount = useMemo(() => {
    return cart.groups.reduce((acc, g) => {
      return acc + g.items.reduce((a, it) => a + Number(it.quantity), 0);
    }, 0);
  }, [cart]);

  // Wallet change effect: clear identity-bound state and fetch fresh cart
  useEffect(() => {
    walletGenerationRef.current += 1;
    const gen = walletGenerationRef.current;
    operationGenerationRef.current += 1;

    // Cleanup queued cart work
    Object.values(timersRef.current).forEach(clearTimeout);
    timersRef.current = {};
    pendingDesiredRef.current.clear();
    inFlightUpdateRef.current.clear();
    pendingAddsRef.current.clear();
    pendingPromisesRef.current.clear();
    pendingOpsRef.current = 0;
    setPendingCount(0);
    setCartError(null);
    setCartLoading(false);

    if (!walletKey) {
      setCart({ cart_id: null, groups: [] });
      setCartLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setCartLoading(true);
      setCartError(null);
      try {
        const next = await getActiveCart(walletKey);
        if (cancelled) return;
        if (gen !== walletGenerationRef.current) return;
        if (walletKey !== (connected && address ? address : null)) return;
        setCart(next);
      } catch (err) {
        if (cancelled) return;
        if (gen !== walletGenerationRef.current) return;
        if (walletKey !== (connected && address ? address : null)) return;
        setCartError(err instanceof Error ? err.message : "Failed to load cart.");
        // keep cart empty for failed load of new wallet (don't show A's cart as B's)
        setCart({ cart_id: null, groups: [] });
      } finally {
        if (cancelled) return;
        if (gen === walletGenerationRef.current) {
          const stillCurrent = connected && address ? address : null;
          if (stillCurrent === walletKey) setCartLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletKey]);

  // Unmount cleanup for debounce timers
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  const refreshCart = useCallback(async () => {
    const gen = walletGenerationRef.current;
    const walletAtCall = address;
    const connectedAtCall = connected;
    if (!walletAtCall || !connectedAtCall) return;
    setCartLoading(true);
    setCartError(null);
    try {
      const next = await getActiveCart(walletAtCall);
      if (gen !== walletGenerationRef.current) return;
      if (walletAtCall !== address) return;
      if (!connected) return;
      setCart(next);
    } catch (err) {
      if (gen !== walletGenerationRef.current) return;
      if (walletAtCall !== address) return;
      setCartError(err instanceof Error ? err.message : "Failed to load cart.");
    } finally {
      if (gen === walletGenerationRef.current && walletAtCall === address && connected) {
        setCartLoading(false);
      } else if (gen !== walletGenerationRef.current) {
        // stale, don't touch loading for new generation
      } else {
        setCartLoading(false);
      }
    }
  }, [address, authenticated, connected]);

  const getConfirmedCart = useCallback(async (): Promise<CartState | null> => {
    const walletAtCall = address;
    const connectedAtCall = connected;
    const genAtCall = walletGenerationRef.current;
    if (!walletAtCall || !connectedAtCall) return null;

    // Flush loop: ensure debounced updates are sent and all in-flight work settles
    // We loop until no pendingDesired and no timers remain, handling coalesced updates that arrived during flight.
    let loopGuard = 0;
    while (loopGuard < 10) {
      loopGuard += 1;
      const pendingEntries = Array.from(pendingDesiredRef.current.entries());
      // Clear timers for pending items
      for (const [itemId] of pendingEntries) {
        const t = timersRef.current[itemId];
        if (t) {
          clearTimeout(t);
          delete timersRef.current[itemId];
        }
      }
      // Also clear any stray timers without pendingDesired (edge)
      for (const itemId of Object.keys(timersRef.current)) {
        clearTimeout(timersRef.current[itemId]);
        delete timersRef.current[itemId];
      }

      const toExecute = pendingEntries.filter(([itemId]) => !inFlightUpdateRef.current.has(itemId));
      if (toExecute.length === 0) break;

      const immediatePromises: Promise<void>[] = [];
      for (const [itemId] of toExecute) {
        const desired = pendingDesiredRef.current.get(itemId);
        if (desired === undefined) continue;
        const opId = ++operationGenerationRef.current;
        const capturedWallet = walletAtCall;
        const capturedGen = genAtCall;
        const promise = (async () => {
          inFlightUpdateRef.current.set(itemId, true);
          try {
            const updated = await updateCartItemQuantity(capturedWallet, itemId, desired);
            if (capturedGen !== walletGenerationRef.current) return;
            if (capturedWallet !== address) return;
            const stillPending = pendingDesiredRef.current.get(itemId);
            if (stillPending !== undefined && stillPending !== desired) return;
            if (opId !== operationGenerationRef.current && pendingDesiredRef.current.has(itemId)) return;
            if (opId < operationGenerationRef.current && (pendingDesiredRef.current.size > 0 || pendingAddsRef.current.size > 0)) return;
            pendingDesiredRef.current.delete(itemId);
            setCart(updated);
            setCartError(null);
          } catch (err) {
            if (capturedGen !== walletGenerationRef.current) return;
            if (capturedWallet !== address) return;
            pendingDesiredRef.current.delete(itemId);
            setCartError(err instanceof Error ? err.message : "Failed to update cart item.");
            try {
              const refreshed = await getActiveCart(capturedWallet);
              if (capturedGen !== walletGenerationRef.current) return;
              if (capturedWallet !== address) return;
              if (opId === operationGenerationRef.current) setCart(refreshed);
            } catch {
              // ignore
            }
          } finally {
            inFlightUpdateRef.current.delete(itemId);
            updatePendingCount(-1);
          }
        })();
        immediatePromises.push(promise);
        pendingPromisesRef.current.add(promise);
        promise.finally(() => pendingPromisesRef.current.delete(promise));
      }

      if (immediatePromises.length > 0) {
        await Promise.allSettled(immediatePromises);
      } else {
        break;
      }

      // If new pendingDesired was added during flight, loop again
      if (pendingDesiredRef.current.size === 0) break;
    }

    // Wait for any other in-flight adds/updates (including follow-ups from adds)
    if (pendingPromisesRef.current.size > 0) {
      await Promise.allSettled(Array.from(pendingPromisesRef.current));
      // After adds settle, there may be new pendingDesired queued; flush again
      if (pendingDesiredRef.current.size > 0) {
        return getConfirmedCart();
      }
    }

    // Now fetch confirmed snapshot
    if (genAtCall !== walletGenerationRef.current) return null;
    if (walletAtCall !== address) return null;
    try {
      const confirmed = await getActiveCart(walletAtCall);
      if (genAtCall !== walletGenerationRef.current) return null;
      if (walletAtCall !== address) return null;
      setCart(confirmed);
      setCartError(null);
      return confirmed;
    } catch (err) {
      if (genAtCall !== walletGenerationRef.current) return null;
      setCartError(err instanceof Error ? err.message : "Failed to load cart.");
      return null;
    }
  }, [address, connected, updatePendingCount]);

  const flushPendingUpdates = useCallback(async () => {
    await getConfirmedCart();
  }, [getConfirmedCart]);

  const executeUpdate = useCallback(
    async (itemId: string, desiredQty: number, walletAtCall: string, genAtCall: number, opId: number) => {
      inFlightUpdateRef.current.set(itemId, true);
      try {
        const updated = await updateCartItemQuantity(walletAtCall, itemId, desiredQty);
        if (genAtCall !== walletGenerationRef.current) return;
        if (walletAtCall !== address) return;
        const stillPending = pendingDesiredRef.current.get(itemId);
        if (stillPending !== undefined && stillPending !== desiredQty) {
          // Newer desired exists, ignore stale response
          return;
        }
        if (opId !== operationGenerationRef.current && pendingDesiredRef.current.has(itemId)) {
          return;
        }
        // Only apply if this is still the latest operation or no newer pending
        if (opId < operationGenerationRef.current) {
          // If there are any pending desired for other items, this stale whole-cart could undo them
          // So ignore unless no pendingDesired and no pendingAdds
          if (pendingDesiredRef.current.size > 0 || pendingAddsRef.current.size > 0) return;
          // Also check global staleness: if opId is not latest, ignore
          // But to allow final convergence, we should only apply latest op's cart
          return;
        }
        pendingDesiredRef.current.delete(itemId);
        setCart(updated);
        setCartError(null);
      } catch (err) {
        if (genAtCall !== walletGenerationRef.current) return;
        if (walletAtCall !== address) return;
        pendingDesiredRef.current.delete(itemId);
        setCartError(err instanceof Error ? err.message : "Failed to update cart item.");
        // Rollback
        try {
          const refreshed = await getActiveCart(walletAtCall);
          if (genAtCall !== walletGenerationRef.current) return;
          if (walletAtCall !== address) return;
          // Only rollback if this was latest op
          if (opId === operationGenerationRef.current) setCart(refreshed);
        } catch {
          // ignore
        }
      } finally {
        inFlightUpdateRef.current.delete(itemId);
        updatePendingCount(-1);
        // If during flight a new desired was queued for same item, schedule next update
        const nextDesired = pendingDesiredRef.current.get(itemId);
        if (nextDesired !== undefined && !inFlightUpdateRef.current.has(itemId)) {
          // There is a newer desired that was set while this request was in flight (via setQuantity)
          // It will have its own timer; but if that timer already fired and pendingDesired still exists but no timer, we need to trigger
          // Check if timer exists
          if (!timersRef.current[itemId]) {
            // Trigger immediate follow-up update to converge to last requested quantity
            const nextWallet = address;
            const nextGen = walletGenerationRef.current;
            if (nextWallet && connected && nextGen === genAtCall) {
              // Use same wallet if still same, else ignore (wallet changed)
              if (nextWallet === walletAtCall) {
                // Increment operation generation for this follow-up
                const nextOpId = ++operationGenerationRef.current;
                updatePendingCount(1);
                void executeUpdate(itemId, nextDesired, nextWallet, nextGen, nextOpId);
              }
            }
          }
        }
      }
    },
    [address, connected, updatePendingCount],
  );

  const setQuantityForProduct = useCallback(
    (productId: string, quantity: number) => {
      if (!address || !connected || !authenticated) return;
      const nextQty = Math.max(0, Math.floor(quantity));
      const walletAtCall = address;
      const genAtCall = walletGenerationRef.current;

      const findItem = (pid: string) => {
        for (const g of cartRef.current.groups) {
          const it = g.items.find((x) => x.product_id === pid);
          if (it) return { itemId: it.id, quantity: Number(it.quantity), group: g, unit_price: it.unit_price };
        }
        return null;
      };

      if (nextQty === 0) {
        const existing = findItem(productId);
        if (existing) {
          const { itemId } = existing;
          // Clear any pending update for this item
          if (timersRef.current[itemId]) {
            clearTimeout(timersRef.current[itemId]);
            delete timersRef.current[itemId];
            // pending count will be adjusted after removing desired? Keep count until operation completes
            // But we are cancelling debounce, so we should decrement pending count if we had incremented
            if (pendingDesiredRef.current.has(itemId)) {
              pendingDesiredRef.current.delete(itemId);
              updatePendingCount(-1);
            }
          }
          if (inFlightUpdateRef.current.has(itemId)) {
            // If update in flight, queue removal after it completes? For now just proceed to delete
            // Mark pendingDesired as 0 to indicate removal intent
            pendingDesiredRef.current.set(itemId, 0);
          } else {
            const opId = ++operationGenerationRef.current;
            updatePendingCount(1);
            const promise = (async () => {
              try {
                const updated = await removeCartItem(walletAtCall, itemId);
                if (genAtCall !== walletGenerationRef.current) return;
                if (walletAtCall !== address) return;
                if (opId !== operationGenerationRef.current) {
                  // stale: if newer operation exists, ignore unless no pending
                  if (pendingDesiredRef.current.size > 0 || pendingAddsRef.current.size > 0) return;
                  return;
                }
                // Clear any pending desired for this item
                pendingDesiredRef.current.delete(itemId);
                setCart(updated);
                setCartError(null);
              } catch (err) {
                if (genAtCall !== walletGenerationRef.current) return;
                if (walletAtCall !== address) return;
                setCartError(err instanceof Error ? err.message : "Failed to remove item.");
                try {
                  const refreshed = await getActiveCart(walletAtCall);
                  if (genAtCall !== walletGenerationRef.current) return;
                  if (walletAtCall !== address) return;
                  if (opId === operationGenerationRef.current) setCart(refreshed);
                } catch {
                  // ignore
                }
              } finally {
                updatePendingCount(-1);
              }
            })();
            pendingPromisesRef.current.add(promise);
            promise.finally(() => pendingPromisesRef.current.delete(promise));
          }
        }
        return;
      }

      const existing = findItem(productId);
      if (!existing) {
        // Dedup in-flight add for same product
        const pendingAdd = pendingAddsRef.current.get(productId);
        if (pendingAdd) {
          // Coalesce to last desired quantity
          pendingAdd.desiredQty = nextQty;
          return;
        }

        pendingAddsRef.current.set(productId, { desiredQty: nextQty, inFlight: true });
        updatePendingCount(1);
        const opId = ++operationGenerationRef.current;
        const initialQty = nextQty;
        const promise = (async () => {
          try {
            const updated = await addItemToCart(walletAtCall, productId, initialQty);
            if (genAtCall !== walletGenerationRef.current) return;
            if (walletAtCall !== address) return;
            if (opId !== operationGenerationRef.current && pendingDesiredRef.current.size > 0) {
              // stale response with pending updates, check if desired changed
            }
            setCart(updated);
            // Update cartRef for future findItem (cart will update via setCart, but cartRef lags until effect)
            // Check if desired changed during flight
            const pending = pendingAddsRef.current.get(productId);
            const finalDesired = pending?.desiredQty ?? initialQty;
            if (finalDesired !== initialQty) {
              // Need to adjust quantity to final desired via update
              // Find the newly added item's id from updated cart
              let newItemId: string | null = null;
              for (const g of updated.groups) {
                const it = g.items.find((x) => x.product_id === productId);
                if (it) {
                  newItemId = it.id;
                  break;
                }
              }
              if (newItemId) {
                // Clear the pending add entry before triggering update to avoid recursion
                pendingAddsRef.current.delete(productId);
                // Now perform update to final desired
                // Use executeUpdate path but via setQuantity logic: we can directly call update
                // To avoid double counting pending, we already have 1 pending for add, we will keep it until update completes?
                // Instead, keep pending count for this follow-up: increment for update, decrement for add will happen in finally
                // For simplicity, trigger an update after add completes
                const followOpId = ++operationGenerationRef.current;
                updatePendingCount(1);
                try {
                  const afterUpdate = await updateCartItemQuantity(walletAtCall, newItemId, finalDesired);
                  if (genAtCall !== walletGenerationRef.current) return;
                  if (walletAtCall !== address) return;
                  if (followOpId !== operationGenerationRef.current) {
                    // stale check
                    return;
                  }
                  setCart(afterUpdate);
                } catch (err) {
                  if (genAtCall !== walletGenerationRef.current) return;
                  if (walletAtCall !== address) return;
                  setCartError(err instanceof Error ? err.message : "Failed to update cart item.");
                } finally {
                  updatePendingCount(-1);
                }
              }
            }
            setCartError(null);
          } catch (err) {
            if (genAtCall !== walletGenerationRef.current) return;
            if (walletAtCall !== address) return;
            setCartError(err instanceof Error ? err.message : "Failed to add item.");
            // On failure, ensure we don't leave stale cart; refresh
            try {
              const refreshed = await getActiveCart(walletAtCall);
              if (genAtCall !== walletGenerationRef.current) return;
              if (walletAtCall !== address) return;
              setCart(refreshed);
            } catch {
              // ignore
            }
          } finally {
            // Only delete if still present and desired equals initial or we handled follow-up
            const pending = pendingAddsRef.current.get(productId);
            if (pending && pending.desiredQty === initialQty) {
              pendingAddsRef.current.delete(productId);
            } else if (pending && pending.desiredQty !== initialQty) {
              // Already handled follow-up, now delete
              pendingAddsRef.current.delete(productId);
            } else {
              pendingAddsRef.current.delete(productId);
            }
            updatePendingCount(-1);
          }
        })();
        pendingPromisesRef.current.add(promise);
        promise.finally(() => pendingPromisesRef.current.delete(promise));
        return;
      }

      const { itemId, unit_price } = existing;

      // Optimistic update with recomputed subtotal
      setCart((prev) => {
        const nextGroups = prev.groups.map((g) => {
          const hasItem = g.items.some((it) => it.id === itemId);
          if (!hasItem) return g;
          const nextItems = g.items.map((it) => (it.id === itemId ? { ...it, quantity: String(nextQty) } : it));
          const nextSubtotal = computeGroupSubtotal(nextItems.map((it) => ({ quantity: it.quantity, unit_price: it.unit_price })));
          return { ...g, items: nextItems, subtotal: nextSubtotal };
        });
        return { ...prev, groups: nextGroups };
      });

      // Coalesce per item: store latest desired
      const hadTimer = !!timersRef.current[itemId];
      if (!hadTimer) {
        updatePendingCount(1);
      }
      pendingDesiredRef.current.set(itemId, nextQty);

      if (timersRef.current[itemId]) clearTimeout(timersRef.current[itemId]);
      timersRef.current[itemId] = setTimeout(() => {
        const desired = pendingDesiredRef.current.get(itemId);
        if (desired === undefined) return;
        // Keep desired in map until execute completes (to detect stale)
        delete timersRef.current[itemId];
        const opId = ++operationGenerationRef.current;
        void executeUpdate(itemId, desired, walletAtCall, genAtCall, opId);
      }, 500);
    },
    [address, connected, executeUpdate, updatePendingCount],
  );

  const removeCartItemFn = useCallback(
    async (itemId: string) => {
      if (!address) return;
      const walletAtCall = address;
      const genAtCall = walletGenerationRef.current;
      const opId = ++operationGenerationRef.current;

      // Clear any pending debounce for this item
      if (timersRef.current[itemId]) {
        clearTimeout(timersRef.current[itemId]);
        delete timersRef.current[itemId];
        if (pendingDesiredRef.current.has(itemId)) {
          pendingDesiredRef.current.delete(itemId);
          updatePendingCount(-1);
        }
      }

      updatePendingCount(1);
      const promise = (async () => {
        try {
          const updated = await removeCartItem(walletAtCall, itemId);
          if (genAtCall !== walletGenerationRef.current) return;
          if (walletAtCall !== address) return;
          if (opId !== operationGenerationRef.current) {
            if (pendingDesiredRef.current.size > 0 || pendingAddsRef.current.size > 0) return;
            return;
          }
          pendingDesiredRef.current.delete(itemId);
          inFlightUpdateRef.current.delete(itemId);
          setCart(updated);
          setCartError(null);
        } catch (err) {
          if (genAtCall !== walletGenerationRef.current) return;
          if (walletAtCall !== address) return;
          setCartError(err instanceof Error ? err.message : "Failed to remove item.");
          try {
            const refreshed = await getActiveCart(walletAtCall);
            if (genAtCall !== walletGenerationRef.current) return;
            if (walletAtCall !== address) return;
            if (opId === operationGenerationRef.current) setCart(refreshed);
          } catch {
            // ignore
          }
        } finally {
          updatePendingCount(-1);
        }
      })();
      pendingPromisesRef.current.add(promise);
      await promise;
      pendingPromisesRef.current.delete(promise);
    },
    [address, updatePendingCount],
  );

  const clearCartFn = useCallback(async () => {
    if (!address) return;
    const walletAtCall = address;
    const genAtCall = walletGenerationRef.current;
    const opId = ++operationGenerationRef.current;

    // Cancel all pending work
    Object.values(timersRef.current).forEach(clearTimeout);
    timersRef.current = {};
    pendingDesiredRef.current.clear();
    pendingAddsRef.current.clear();
    // Note: pending count will be reset after? For now just proceed
    // But we should adjust pendingCount to 0 then add 1 for clear
    // Simplify: reset pendingOps
    const previousPending = pendingOpsRef.current;
    pendingOpsRef.current = 0;
    setPendingCount(0);
    updatePendingCount(1);

    try {
      const updated = await clearCart(walletAtCall);
      if (genAtCall !== walletGenerationRef.current) return;
      if (walletAtCall !== address) return;
      if (opId !== operationGenerationRef.current) return;
      setCart(updated);
      setCartError(null);
    } catch (err) {
      if (genAtCall !== walletGenerationRef.current) return;
      if (walletAtCall !== address) return;
      setCartError(err instanceof Error ? err.message : "Failed to clear cart.");
    } finally {
      updatePendingCount(-1);
    }
  }, [address, updatePendingCount]);

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
      hasPendingUpdates,
      pendingCount,
      flushPendingUpdates,
      getConfirmedCart,
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
      hasPendingUpdates,
      pendingCount,
      flushPendingUpdates,
      getConfirmedCart,
    ],
  );

  return <CartContext.Provider value={ctx}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
