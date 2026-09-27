"use client";

import { useState, useEffect, useCallback } from "react";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { safePercentage } from "@/lib/validation";

interface GroupOrder {
  id: string;
  productName: string;
  currentQuantity: number;
  targetQuantity: number;
  pricePerUnit: number;
  expiresAt: string;
  status: "open" | "expired" | "completed";
}

interface GroupOrderUpdatePayload {
  orderId: string;
  currentQuantity: number;
}

export default function GroupOrdersPage() {
  const [groupOrders, setGroupOrders] = useState<GroupOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const updateGroupOrderProgress = useCallback(
    (data: GroupOrderUpdatePayload) => {
      setGroupOrders((prev) =>
        prev.map((order) =>
          order.id === data.orderId
            ? { ...order, currentQuantity: data.currentQuantity }
            : order,
        ),
      );
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

  useEffect(() => {
    fetchGroupOrders();
  }, []);

  const fetchGroupOrders = async () => {
    try {
      const response = await fetch("/api/group-orders");
      const data = await response.json();
      setGroupOrders(data);
    } catch (error) {
      console.error("Failed to fetch group orders:", error);
    } finally {
      setLoading(false);
    }
  };

  const joinPool = async (orderId: string) => {
    try {
      await fetch(`/api/group-orders/${orderId}/join`, { method: "POST" });
      fetchGroupOrders();
    } catch (error) {
      console.error("Failed to join pool:", error);
    }
  };

  const calculateProgress = (order: GroupOrder) => {
    return safePercentage(order.currentQuantity, order.targetQuantity);
  };

  if (loading) {
    return <div className="p-6">Loading group orders...</div>;
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
          {groupOrders.map((order) => (
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
                <p>Price: ${order.pricePerUnit}/unit</p>
                <p>
                  Expires:{" "}
                  {new Date(order.expiresAt).toLocaleDateString()}
                </p>
                <p className="capitalize">Status: {order.status}</p>
              </div>

              {order.status === "open" && (
                <button
                  onClick={() => joinPool(order.id)}
                  className="mt-4 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
                >
                  Join Pool
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
          ))}
        </div>
      )}
    </div>
  );
}
