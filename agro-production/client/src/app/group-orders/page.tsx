"use client";

/**
 * Issue #1257: the Group Orders page used same-origin `fetch("/api/...")`
 * calls that never reached the production server (no Next route
 * handler, no rewrite, no matching backend route). It also swallowed
 * join errors silently and had no pending state on the button.
 *
 * The page now:
 *   - talks to the production server via the shared `apiClient`, which
 *     builds the URL from `NEXT_PUBLIC_API_URL` and already carries
 *     `Authorization: Bearer <access-token>`;
 *   - surfaces non-2xx join responses through an inline error on the
 *     affected card and keeps the button disabled while the join is
 *     in flight (so a mis-clicked double-tap does not retry);
 *   - subscribes to the versioned `group_order.updated` WebSocket
 *     event the server emits on every successful join, so the
 *     progress bar updates without a refetch.
 */

import { useCallback, useState } from "react";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { safePercentage } from "@/lib/validation";
import api, { ApiError } from "@/lib/apiClient";

interface GroupOrder {
  id: string;
  productName: string;
  currentQuantity: number;
  targetQuantity: number;
  pricePerUnit: string;
  expiresAt: string;
  status: "OPEN" | "EXPIRED" | "COMPLETED";
}

interface JoinGroupOrderResponse extends GroupOrder {
  joined: boolean;
}

interface GroupOrderUpdatePayload {
  orderId: string;
  currentQuantity: number;
}

export default function GroupOrdersPage() {
  // Declared before the effect that runs it (#1084: the effect used to call
  // `fetchGroupOrders` before its declaration, which froze the first render's
  // closure). The loader aborts with the owner and the list state is derived.
  const fetchGroupOrders = useCallback(async (signal: AbortSignal) => {
    try {
      return await api.get<GroupOrder[]>("/group-orders", { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      console.error("Failed to fetch group orders:", error);
      throw new Error("Failed to load group orders. Please try again.");
    }
  }, []);

  const { data, error, loading, reload } = useAsyncResource(
    "group-orders",
    fetchGroupOrders,
  );

  // Display state: each fresh response is adopted exactly once during render
  // ("adjust state when data changes" pattern) so the WebSocket handler below
  // can keep applying live quantity updates on top of it without an effect
  // mirroring results into state.
  const [groupOrders, setGroupOrders] = useState<GroupOrder[]>([]);
  const [adopted, setAdopted] = useState<GroupOrder[] | null>(null);
  if (data && data !== adopted) {
    setAdopted(data);
    setGroupOrders(data);
  }

  // Per-order join state so one row's spinner or error does not affect
  // another's. Tracked as two parallel maps so an unmount during a
  // join does not leak stale strings into the UI on remount.
  const [joiningIds, setJoiningIds] = useState<Set<string>>(new Set());
  const [joinErrors, setJoinErrors] = useState<Record<string, string>>({});

  const applyUpdate = useCallback((update: GroupOrderUpdatePayload) => {
    setGroupOrders((prev) =>
      prev.map((order) =>
        order.id === update.orderId
          ? { ...order, currentQuantity: update.currentQuantity }
          : order,
      ),
    );
  }, []);

  useWebSocket(
    useCallback(
      (message: WsMessage) => {
        if (message.type === "group_order.updated") {
          // Ignore messages with an unrecognised version or malformed payload.
          if (message.version !== "1") return;
          const payload = message.payload as GroupOrderUpdatePayload;
          if (
            typeof payload?.orderId === "string" &&
            typeof payload?.currentQuantity === "number"
          ) {
            applyUpdate(payload);
          }
        }
      },
      [applyUpdate],
    ),
  );

  const joinPool = useCallback(
    async (orderId: string) => {
      if (joiningIds.has(orderId)) return;
      setJoiningIds((prev) => {
        const next = new Set(prev);
        next.add(orderId);
        return next;
      });
      setJoinErrors((prev) => {
        if (!(orderId in prev)) return prev;
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      try {
        const updated = await api.post<JoinGroupOrderResponse>(
          `/group-orders/${encodeURIComponent(orderId)}/join`,
          {},
        );
        // Server already emits the WS event; apply the authoritative
        // response straight away so the user who clicked sees their
        // progress bar move without waiting for the round trip.
        applyUpdate({
          orderId: updated.id,
          currentQuantity: updated.currentQuantity,
        });
        setGroupOrders((prev) =>
          prev.map((order) =>
            order.id === updated.id ? { ...order, ...updated } : order,
          ),
        );
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.status === 401
              ? "Sign in to join this group order."
              : err.status === 409
                ? "This order is no longer open."
                : err.status === 404
                  ? "This order no longer exists."
                  : err.message
            : err instanceof Error
              ? err.message
              : "Could not join this order. Please try again.";
        setJoinErrors((prev) => ({ ...prev, [orderId]: message }));
      } finally {
        setJoiningIds((prev) => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
      }
    },
    [applyUpdate, joiningIds],
  );

  const calculateProgress = (order: GroupOrder) => {
    return safePercentage(order.currentQuantity, order.targetQuantity);
  };

  if (loading) {
    return <div className="p-6">Loading group orders...</div>;
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Group Buy Orders</h1>
        <div
          className="border border-red-200 bg-red-50 rounded-xl p-6 text-red-700 text-sm space-y-3"
          role="alert"
        >
          <p>{error}</p>
          <button onClick={reload} className="underline text-red-700 hover:text-red-900">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Group Buy Orders</h1>

      {groupOrders.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No active group orders at the moment
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {groupOrders.map((order) => {
            const joining = joiningIds.has(order.id);
            const joinError = joinErrors[order.id];
            return (
              <div
                key={order.id}
                className="border rounded-lg p-6 shadow-sm hover:shadow-md transition"
              >
                <h3 className="text-xl font-semibold mb-2">{order.productName}</h3>

                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Progress</span>
                    <span>
                      {order.currentQuantity} / {order.targetQuantity}
                    </span>
                  </div>
                  <div
                    className="w-full bg-gray-200 rounded-full h-2.5"
                    role="progressbar"
                    aria-valuenow={calculateProgress(order)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="bg-green-600 h-2.5 rounded-full"
                      style={{ width: `${calculateProgress(order)}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <p>Price: {order.pricePerUnit}/unit</p>
                  <p>
                    Expires:{" "}
                    {new Date(order.expiresAt).toLocaleDateString()}
                  </p>
                  <p className="capitalize">Status: {order.status.toLowerCase()}</p>
                </div>

                {order.status === "OPEN" && (
                  <>
                    <button
                      onClick={() => joinPool(order.id)}
                      disabled={joining}
                      className="mt-4 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {joining ? "Joining..." : "Join Pool"}
                    </button>
                    {joinError && (
                      <p className="mt-2 text-sm text-red-600" role="alert">
                        {joinError}
                      </p>
                    )}
                  </>
                )}

                {order.status === "EXPIRED" && (
                  <div className="mt-4 text-red-500 text-center">
                    Order Expired
                  </div>
                )}

                {order.status === "COMPLETED" && (
                  <div className="mt-4 text-green-500 text-center">
                    Order Completed
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
