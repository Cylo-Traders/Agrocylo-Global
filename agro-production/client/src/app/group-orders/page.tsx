"use client";

import { useCallback, useState } from "react";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { safePercentage } from "@/lib/validation";
import {
  applyGroupOrderUpdate,
  fetchGroupOrders as fetchGroupOrdersApi,
  joinGroupOrderPool,
  type GroupOrder,
  type GroupOrderUpdatePayload,
} from "@/services/groupOrderService";

export default function GroupOrdersPage() {
  // Declared before the effect that runs it (#1084: the effect used to call
  // `fetchGroupOrders` before its declaration, which froze the first render's
  // closure). The loader aborts with the owner and the list state is derived.
  const loadGroupOrders = useCallback(async (signal: AbortSignal) => {
    try {
      return await fetchGroupOrdersApi({ signal });
    } catch (error) {
      if (signal.aborted) throw error;
      console.error("Failed to fetch group orders:", error);
      throw new Error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to load group orders. Please try again.",
      );
    }
  }, []);

  const { data, error, loading, reload } = useAsyncResource(
    "group-orders",
    loadGroupOrders,
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

  const [joiningOrderId, setJoiningOrderId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const updateGroupOrderProgress = useCallback(
    (update: GroupOrderUpdatePayload) => {
      setGroupOrders((prev) => applyGroupOrderUpdate(prev, update));
    },
    [],
  );

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
            updateGroupOrderProgress(payload);
          }
        }
      },
      [updateGroupOrderProgress],
    ),
  );

  const joinPool = async (orderId: string) => {
    if (joiningOrderId) return;
    setJoiningOrderId(orderId);
    setJoinError(null);
    try {
      const updated = await joinGroupOrderPool(orderId, {
        idempotencyKey: `join:${orderId}`,
      });
      updateGroupOrderProgress({
        orderId: updated.id,
        currentQuantity: updated.currentQuantity,
        targetQuantity: updated.targetQuantity,
        status: updated.status,
      });
      reload();
    } catch (err) {
      console.error("Failed to join pool:", err);
      setJoinError(
        err instanceof Error && err.message
          ? err.message
          : "Failed to join group order pool. Please try again.",
      );
    } finally {
      setJoiningOrderId(null);
    }
  };

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

      {joinError && (
        <div
          className="mb-6 border border-red-200 bg-red-50 rounded-xl p-4 text-red-700 text-sm"
          role="alert"
        >
          {joinError}
        </div>
      )}

      {groupOrders.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No active group orders at the moment
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {groupOrders.map((order) => {
            const isJoining = joiningOrderId === order.id;
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
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className="bg-green-600 h-2.5 rounded-full"
                      style={{ width: `${calculateProgress(order)}%` }}
                    ></div>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <p>Price: {order.pricePerUnit}/unit</p>
                  <p>
                    Expires:{" "}
                    {new Date(order.expiresAt).toLocaleDateString()}
                  </p>
                  <p className="capitalize">Status: {order.status}</p>
                </div>

                {order.status === "open" && (
                  <button
                    type="button"
                    disabled={isJoining}
                    aria-busy={isJoining}
                    onClick={() => joinPool(order.id)}
                    className="mt-4 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isJoining ? "Joining..." : "Join Pool"}
                  </button>
                )}

                {order.status === "expired" && (
                  <div className="mt-4 text-red-500 text-center">
                    Order Expired
                  </div>
                )}

                {order.status === "completed" && (
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
