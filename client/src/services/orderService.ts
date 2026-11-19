/**
 * Order Service – Manages order queries
 * 
 * This service is responsible for:
 * 1. Listing orders for a buyer/seller
 * 2. Getting order details
 * 3. Test mode support (returns dummy data in E2E tests)
 *
 * The /orders endpoints require a wallet session (#617), so every call goes
 * through apiRequest which attaches the Bearer token and refreshes it on 401.
 * Server rows are normalized into the client Order shape (title-case status,
 * unix-seconds createdAt, bigint amount) so the dashboard/earnings/orders
 * views can render them directly (#1184).
 */

import type { Order } from "@/services/stellar/contractService";

import { ApiRequestError, apiRequest } from "@/lib/apiHelper";
import { isTestMode } from "@/lib/testMode";

/** Raw order row as returned by the backend (Prisma model + includes). */
interface ServerOrderRow {
  orderIdOnChain?: string | null;
  orderId?: string | number | null;
  buyerAddress?: string | null;
  sellerAddress?: string | null;
  buyer?: string | null;
  seller?: string | null;
  amount?: string | number | null;
  status?: string | null;
  createdAt?: string | number | null;
  txHash?: string | null;
}

/** "PENDING" / "pending" → "Pending" (matches StatusBadge + status filters). */
function toTitleCaseStatus(status: string | null | undefined): string {
  if (!status) return "";
  const trimmed = status.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** Normalize a server row into the client Order contract. */
export function mapServerOrder(row: ServerOrderRow): Order {
  const rawCreated = row.createdAt;
  let createdAt = 0;
  if (typeof rawCreated === "number") {
    createdAt = rawCreated > 1e12 ? Math.floor(rawCreated / 1000) : rawCreated;
  } else if (typeof rawCreated === "string") {
    const parsed = Date.parse(rawCreated);
    createdAt = Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }

  const amountRaw = row.amount ?? 0;
  let amount: bigint;
  try {
    amount = typeof amountRaw === "bigint" ? amountRaw : BigInt(String(amountRaw));
  } catch {
    amount = 0n;
  }

  return {
    orderId: String(row.orderIdOnChain ?? row.orderId ?? ""),
    buyer: String(row.buyer ?? row.buyerAddress ?? ""),
    seller: String(row.seller ?? row.sellerAddress ?? ""),
    amount,
    status: toTitleCaseStatus(row.status),
    createdAt,
    ...(row.txHash ? { txHash: row.txHash } : {}),
  };
}

/**
 * Shared GET for the authenticated /orders endpoints.
 * - 401/403: no usable session — return [] quietly (the wallet gate owns
 *   prompting re-authentication; don't spam the console).
 * - Other failures: throw so React Query can surface the existing error UI
 *   instead of silently rendering "No orders yet".
 */
async function fetchOrders(path: string): Promise<Order[]> {
  let rows: ServerOrderRow[];
  try {
    rows = await apiRequest<ServerOrderRow[]>(path);
  } catch (err) {
    if (
      err instanceof ApiRequestError &&
      (err.status === 401 || err.status === 403)
    ) {
      console.warn(
        `Seller/buyer orders: unauthenticated (${err.status}). Wallet session may have expired.`,
      );
      return [];
    }
    throw err;
  }
  return (Array.isArray(rows) ? rows : []).map(mapServerOrder);
}

/**
 * Generate a deterministic fake order for testing
 */
function generateTestOrder(index: number, buyerAddress: string, sellerAddress: string): Order {
  const now = Math.floor(Date.now() / 1000);
  return {
    orderId: String(1000 + index),
    buyer: buyerAddress,
    seller: sellerAddress,
    amount: BigInt(10 * 1e7), // 10 XLM in stroops
    status: index === 0 ? "Pending" : "Completed",
    createdAt: now - (index * 3600), // Staggered by hour
  };
}

/**
 * Fetch orders where the user is the buyer
 */
export async function listOrdersAsBuyer(buyerAddress: string): Promise<Order[]> {
  // Test mode: return dummy orders
  if (isTestMode()) {
    return [
      generateTestOrder(0, buyerAddress, "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37"),
    ];
  }

  return fetchOrders(`/orders/buyer/${buyerAddress}`);
}

/**
 * Fetch orders where the user is the seller
 */
export async function listOrdersAsSeller(sellerAddress: string): Promise<Order[]> {
  // Test mode: return empty (seller doesn't use this page in tests)
  if (isTestMode()) {
    return [];
  }

  return fetchOrders(`/orders/seller/${sellerAddress}`);
}

/**
 * Get all orders (admin endpoint)
 */
export async function listAllOrders(): Promise<Order[]> {
  // Test mode: return empty
  if (isTestMode()) {
    return [];
  }

  return fetchOrders("/orders");
}
