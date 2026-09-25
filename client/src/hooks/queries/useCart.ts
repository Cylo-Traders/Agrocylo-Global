"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/hooks/useWallet";
import { queryKeys } from "@/lib/queryKeys";
import {
  getActiveCart,
  addItemToCart,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
} from "@/services/cartService";

/** Active cart for the connected wallet. */
export function useActiveCart() {
  const { address, connected } = useWallet();
  const qc = useQueryClient();
  // Remove previous wallet's private cache when wallet changes or disconnects
  const prevWalletRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const current = connected && address ? address : null;
    const prev = prevWalletRef.current;
    if (prev && prev !== current) {
      qc.removeQueries({ queryKey: queryKeys.cart.byWallet(prev) });
      // also remove legacy unscoped key if present
      qc.removeQueries({ queryKey: ["cart"] as const });
    }
    prevWalletRef.current = current;
    if (!current) {
      qc.removeQueries({ queryKey: ["cart"] as const });
    }
  }, [address, connected, qc]);

  return useQuery({
    queryKey: address ? queryKeys.cart.byWallet(address) : queryKeys.cart.all(),
    queryFn: () => getActiveCart(address!),
    enabled: connected && authenticated && !!address,
  });
}

export function useAddCartItem() {
  const { address } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { productId: string; quantity: number }) =>
      addItemToCart(address!, input.productId, input.quantity),
    onSuccess: (cart) => {
      if (address) qc.setQueryData(queryKeys.cart.byWallet(address), cart);
    },
  });
}

export function useUpdateCartItem() {
  const { address } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemId: string; quantity: number }) =>
      updateCartItemQuantity(address!, input.itemId, input.quantity),
    onSuccess: (cart) => {
      if (address) qc.setQueryData(queryKeys.cart.byWallet(address), cart);
    },
  });
}

export function useRemoveCartItem() {
  const { address } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => removeCartItem(address!, itemId),
    onSuccess: (cart) => {
      if (address) qc.setQueryData(queryKeys.cart.byWallet(address), cart);
    },
  });
}

export function useClearCart() {
  const { address } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => clearCart(address!),
    onSuccess: (cart) => {
      if (address) qc.setQueryData(queryKeys.cart.byWallet(address), cart);
    },
  });
}
