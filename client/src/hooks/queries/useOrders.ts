"use client";

import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/hooks/useWallet";
import { queryKeys } from "@/lib/queryKeys";
import {
  listOrdersAsBuyer,
  listOrdersAsSeller,
} from "@/services/orderService";

/** Orders where the connected wallet is the buyer. */
export function useBuyerOrders() {
  const { address, connected } = useWallet();
  return useQuery({
    queryKey: queryKeys.orders.asBuyer(address ?? ""),
    queryFn: () => listOrdersAsBuyer(address!),
    enabled: connected && !!address,
  });
}

/** Orders where the connected wallet is the seller (farmer). */
export function useSellerOrders() {
  const { address, connected } = useWallet();
  return useQuery({
    queryKey: queryKeys.orders.asSeller(address ?? ""),
    queryFn: () => listOrdersAsSeller(address!),
    enabled: connected && !!address,
  });
}

// perf optimization
