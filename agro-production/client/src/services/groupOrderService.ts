import api, { type ApiClient } from "@/lib/apiClient";

export type GroupOrderStatus = "open" | "expired" | "completed";

export interface GroupOrder {
  id: string;
  productId?: string | null;
  productName: string;
  currentQuantity: number;
  targetQuantity: number;
  pricePerUnit: number;
  expiresAt: string;
  status: GroupOrderStatus;
}

export interface JoinGroupOrderResponse extends GroupOrder {
  joined: boolean;
  idempotentReplay: boolean;
}

export interface GroupOrderUpdatePayload {
  orderId: string;
  currentQuantity: number;
  targetQuantity?: number;
  status?: GroupOrderStatus;
}

export interface GroupOrderClientLike {
  get: ApiClient["get"];
  post: ApiClient["post"];
}

/**
 * Fetches group-buy pools through the shared API client (#1257) so
 * NEXT_PUBLIC_API_URL, timeout, retry, and error handling are respected.
 */
export async function fetchGroupOrders(
  options: {
    client?: Pick<GroupOrderClientLike, "get">;
    signal?: AbortSignal;
  } = {},
): Promise<GroupOrder[]> {
  const client = options.client ?? api;
  const result = await client.get<GroupOrder[]>("/group-orders", {
    auth: false,
    signal: options.signal,
  });
  return Array.isArray(result) ? result : [];
}

/**
 * Joins an open group-buy pool through the authenticated API client (#1257).
 * Uses `retries: 0` on POST and forwards an optional `X-Idempotency-Key`.
 */
export async function joinGroupOrderPool(
  orderId: string,
  options: {
    client?: Pick<GroupOrderClientLike, "post">;
    quantity?: number;
    idempotencyKey?: string;
  } = {},
): Promise<JoinGroupOrderResponse> {
  const client = options.client ?? api;
  const sanitizedId = orderId.replace(/[^a-zA-Z0-9-]/g, "");
  const headers: Record<string, string> = {};
  if (options.idempotencyKey) {
    headers["X-Idempotency-Key"] = options.idempotencyKey;
  }

  return client.post<JoinGroupOrderResponse>(
    `/group-orders/${encodeURIComponent(sanitizedId)}/join`,
    { quantity: options.quantity ?? 1 },
    {
      retries: 0,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    },
  );
}

/**
 * Pure reducer that applies a versioned `group_order.updated` WebSocket event
 * to the current list of group orders.
 */
export function applyGroupOrderUpdate(
  orders: GroupOrder[],
  update: GroupOrderUpdatePayload,
): GroupOrder[] {
  return orders.map((order) => {
    if (order.id !== update.orderId) return order;
    const nextQuantity = update.currentQuantity;
    const nextTarget = update.targetQuantity ?? order.targetQuantity;
    const nextStatus: GroupOrderStatus =
      update.status ??
      (nextQuantity >= nextTarget ? "completed" : order.status);
    return {
      ...order,
      currentQuantity: nextQuantity,
      targetQuantity: nextTarget,
      status: nextStatus,
    };
  });
}
