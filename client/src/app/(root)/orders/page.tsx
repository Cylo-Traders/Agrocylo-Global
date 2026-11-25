"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, ShoppingBag } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/hooks/useWallet";
import { listOrdersAsBuyer } from "@/services/orderService";
import { useEscrowContract } from "@/hooks/useEscrowContract";
import OrderCard from "@/components/orders/OrderCard";
import type { Order } from "@/services/stellar/contractService";

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "Pending", label: "Pending" },
  { value: "Completed", label: "Completed" },
  { value: "Disputed", label: "Disputed" },
  { value: "Refunded", label: "Refunded" },
] as const;
type TabValue = (typeof STATUS_TABS)[number]["value"];

export default function OrdersPage() {
  const { address, connected } = useWallet();
  const { confirmReceipt, confirmState } = useEscrowContract();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmErrors, setConfirmErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<TabValue>("all");

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await listOrdersAsBuyer(address);
        if (!cancelled) setOrders(result);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load orders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  async function handleConfirm(orderId: string) {
    setConfirmErrors((prev) => {
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
    try {
      await confirmReceipt(orderId);
      setOrders((prev) =>
        prev.map((o) =>
          o.orderId === orderId ? { ...o, status: "Completed" } : o,
        ),
      );
    } catch (err) {
      setConfirmErrors((prev) => ({
        ...prev,
        [orderId]: err instanceof Error ? err.message : "Receipt confirmation failed. Please retry.",
      }));
    }
  }

  const filtered = useMemo(() => {
    if (tab === "all") return orders;
    return orders.filter((o) => o.status === tab);
  }, [orders, tab]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) map.set(o.status, (map.get(o.status) ?? 0) + 1);
    return map;
  }, [orders]);

  return (
    <Wrapper className="pt-32 pb-20 md:pt-40">
      <PageHeader
        title="My Orders"
        description="Escrow-backed orders you've placed on the Stellar network."
      >
        <Button asChild>
          <Link href="/orders/new">
            <Plus className="size-4" />
            New Order
          </Link>
        </Button>
      </PageHeader>

      <div className="mt-8">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList>
            {STATUS_TABS.map((t) => {
              const count =
                t.value === "all" ? orders.length : (counts.get(t.value) ?? 0);
              return (
                <TabsTrigger key={t.value} value={t.value} className="gap-2">
                  {t.label}
                  <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[10px] font-medium">
                    {count}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-6">
        {!connected || !address ? (
          <EmptyState
            icon={ShoppingBag}
            title="Connect your wallet"
            description="Sign in with Freighter to see your escrow orders."
          />
        ) : loading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-2xl border p-6 text-sm">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title={tab === "all" ? "No orders yet" : `No ${tab.toLowerCase()} orders`}
            description={
              tab === "all"
                ? "Place your first order from the marketplace."
                : "Switch tabs to see orders in other states."
            }
            action={
              tab === "all" ? (
                <Button asChild>
                  <Link href="/market">Browse Market</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.map((order) => (
              <OrderCard
                key={order.orderId}
                order={order}
                isBuyer
                onConfirm={handleConfirm}
                isConfirming={confirmState.isLoading}
                confirmError={confirmErrors[order.orderId]}
              />
            ))}
          </div>
        )}
      </div>
    </Wrapper>
  );
}
