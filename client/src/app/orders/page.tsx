"use client";

import { useEffect, useState } from "react";
import OrderCard from "@/components/orders/OrderCard";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/hooks/useWallet";
import {
  listBuyerOrders,
  type BuyerOrder,
  type BuyerOrderFilter,
} from "@/services/ordersService";
import { confirmDelivery } from "@/services/stellar/contractService";

const FILTERS: Array<{ value: BuyerOrderFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "refunded", label: "Refunded" },
];

export default function OrdersPage() {
  const { address, connected, connect, signAndSubmit } = useWallet();
  const [orders, setOrders] = useState<BuyerOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BuyerOrderFilter>("all");
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !address) return;
    const walletAddress = address;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await listBuyerOrders(walletAddress, filter);
        if (!cancelled) {
          setOrders(response.items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load orders.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [address, connected, filter]);

  async function handleConfirm(orderId: string) {
    if (!address) {
      setError("Connect your wallet to confirm delivery.");
      return;
    }

    setConfirmingOrderId(orderId);
    setError(null);

    try {
      const built = await confirmDelivery(address, orderId);
      if (!built.success || !built.data) {
        throw new Error(built.error ?? "Failed to build confirm transaction.");
      }

      const result = await signAndSubmit(built.data);
      if (!result.success) {
        throw new Error(result.error ?? "Failed to confirm delivery.");
      }

      setOrders((current) =>
        current.map((order) =>
          order.order_id === orderId
            ? { ...order, status: "COMPLETED", updated_at: new Date().toISOString() }
            : order,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm delivery.");
    } finally {
      setConfirmingOrderId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 via-white to-emerald-50/50 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Buyer Dashboard</h1>
            <p className="text-muted">
              Track indexed escrow orders and confirm delivery when goods arrive.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <Button
                key={item.value}
                variant={filter === item.value ? "primary" : "outline"}
                size="sm"
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        {!connected || !address ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-foreground mb-2">Connect your wallet</h2>
            <p className="text-muted mb-6">
              Buyer orders are loaded from the indexer for the connected wallet.
            </p>
            <Button onClick={() => void connect()}>Connect Wallet</Button>
          </div>
        ) : (
          <>
            {error ? (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-neutral-500 shadow-sm">
                Loading buyer orders...
              </div>
            ) : orders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/80 p-10 text-center shadow-sm">
                <h2 className="text-xl font-semibold text-foreground mb-2">No orders found</h2>
                <p className="text-muted">
                  No indexed orders matched the current filter for this buyer wallet.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {orders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onConfirm={handleConfirm}
                    isConfirming={confirmingOrderId === order.order_id}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
