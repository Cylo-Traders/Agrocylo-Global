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

export interface MonthlyOrderBucket {
  /** "YYYY-MM" (UTC) */
  key: string;
  /** e.g. "Jan 2026" */
  month: string;
  gross: number;
  net: number;
  completed: number;
  pending: number;
  refunded: number;
}

const monthLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Bucket orders by UTC calendar month of their `createdAt` (unix seconds),
 * spanning the earliest to the latest dated order with empty months zero-filled.
 * Earnings only count Completed orders; undated orders are skipped.
 * Server rows carry `createdAt`; on-chain `Order` carries `timestamp`.
 */
export function buildMonthlyOrderBuckets(
  orders: {
    status: string;
    amount: bigint | number | string;
    createdAt?: number;
    timestamp?: number;
  }[],
): MonthlyOrderBucket[] {
  const secondsOf = (o: { createdAt?: number; timestamp?: number }) =>
    Number(o.createdAt ?? o.timestamp ?? 0);
  const dated = orders.filter((o) => secondsOf(o) > 0);
  if (dated.length === 0) return [];

  const monthIndex = (o: { createdAt?: number; timestamp?: number }) => {
    const d = new Date(secondsOf(o) * 1000);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  const indices = dated.map(monthIndex);
  const first = Math.min(...indices);
  const last = Math.max(...indices);

  const buckets: MonthlyOrderBucket[] = [];
  for (let i = first; i <= last; i++) {
    const year = Math.floor(i / 12);
    const month = i % 12;
    buckets.push({
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      month: monthLabel(year, month),
      gross: 0,
      net: 0,
      completed: 0,
      pending: 0,
      refunded: 0,
    });
  }

  dated.forEach((o, n) => {
    const b = buckets[indices[n] - first];
    if (o.status === "Completed") {
      const xlm = Number(o.amount ?? 0) / 1e7;
      b.gross += xlm;
      b.net += xlm * 0.97;
      b.completed += 1;
    } else if (o.status === "Pending") {
      b.pending += 1;
    } else if (o.status === "Refunded") {
      b.refunded += 1;
    }
  });

  return buckets;
}
