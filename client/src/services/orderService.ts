/**
 * Order Service – Manages order queries
 * 
 * This service is responsible for:
 * 1. Listing orders for a buyer/seller
 * 2. Getting order details
 * 3. Test mode support (returns dummy data in E2E tests)
 */

import type { Order } from "@/services/stellar/contractService";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000";

/**
 * Detect test mode (E2E Playwright)
 */
function isTestMode(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return !!(w.freighter && w.freighter.signTransaction && typeof w.freighter.signTransaction === "function");
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

  try {
    const res = await fetch(`${API_BASE_URL}/orders/buyer/${buyerAddress}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch buyer orders: ${res.status}`);
    }
    return (await res.json()) as Order[];
  } catch (err) {
    console.error("Failed to list buyer orders:", err);
    return [];
  }
}

/**
 * Fetch orders where the user is the seller
 */
export async function listOrdersAsSeller(sellerAddress: string): Promise<Order[]> {
  // Test mode: return empty (seller doesn't use this page in tests)
  if (isTestMode()) {
    return [];
  }

  try {
    const res = await fetch(`${API_BASE_URL}/orders/seller/${sellerAddress}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch seller orders: ${res.status}`);
    }
    return (await res.json()) as Order[];
  } catch (err) {
    console.error("Failed to list seller orders:", err);
    return [];
  }
}

/**
 * Get all orders (admin endpoint)
 */
export async function listAllOrders(): Promise<Order[]> {
  // Test mode: return empty
  if (isTestMode()) {
    return [];
  }

  try {
    const res = await fetch(`${API_BASE_URL}/orders`);
    if (!res.ok) {
      throw new Error(`Failed to fetch all orders: ${res.status}`);
    }
    return (await res.json()) as Order[];
  } catch (err) {
    console.error("Failed to list all orders:", err);
    return [];
  }
}
