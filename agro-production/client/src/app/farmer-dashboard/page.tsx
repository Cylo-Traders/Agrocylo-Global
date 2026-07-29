"use client";

import { useCallback, useEffect, useState } from "react";

// ── Price-index widget (#696) ──────────────────────────────────────────────
interface PriceIndexEntry {
  crop: string;
  region: string;
  averagePrice: number;
  sampleCount: number;
  computedAt: string;
}

function PriceIndexWidget() {
  const [entries, setEntries] = useState<PriceIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/analytics/price-index")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load price index");
        const json: { data: PriceIndexEntry[] } = await res.json();
        setEntries(json.data ?? []);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Price index unavailable"),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <section aria-labelledby="price-index-heading" className="rounded-xl border border-border bg-surface p-5">
      <h2 id="price-index-heading" className="text-base font-semibold text-foreground mb-3">
        Regional Price Index
      </h2>
      {loading && <p className="text-sm text-muted animate-pulse">Loading price data…</p>}
      {!loading && error && (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      )}
      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-muted">No price data available yet. Index updates hourly as orders are confirmed.</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Regional crop price index">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th scope="col" className="pb-2 font-medium">Crop</th>
                <th scope="col" className="pb-2 font-medium">Region</th>
                <th scope="col" className="pb-2 text-right font-medium">Avg. Price (XLM)</th>
                <th scope="col" className="pb-2 text-right font-medium">Samples</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2 font-medium text-foreground">{e.crop}</td>
                  <td className="py-2 text-muted">{e.region}</td>
                  <td className="py-2 text-right text-foreground">{e.averagePrice.toLocaleString()}</td>
                  <td className="py-2 text-right text-muted">{e.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
// ── end PriceIndexWidget ──────────────────────────────────────────────────
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { OrderTableSkeleton } from "@/components/Skeletons";
import { useWallet } from "@/context/WalletContext";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import {
  filterOrdersForFarmer,
  summarizeFarmerOrders,
} from "@/lib/farmerDashboard";
import { formatAmount } from "@/services/campaignService";
import { fetchOrdersByFarmer } from "@/services/orderService";
import type { Order } from "@/types";

function FulfilmentState({ status }: { status: Order["status"] }) {
  if (status === "CONFIRMED") {
    return <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">Completed</span>;
  }

  return <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">Awaiting fulfilment</span>;
}

function FarmerOrderTable({ orders, label, emptyText }: {
  orders: Order[];
  label: string;
  emptyText: string;
}) {
  if (!orders.length) {
    return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm" aria-label={label}>
        <caption className="sr-only">{label}</caption>
        <thead className="border-b border-border bg-surface text-left text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Order</th>
            <th scope="col" className="px-4 py-3 font-medium">Buyer</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
            <th scope="col" className="px-4 py-3 text-center font-medium">Fulfilment</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Received</th>
            <th scope="col" className="px-4 py-3"><span className="sr-only">Campaign</span></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-border last:border-0 hover:bg-surface">
              <td className="px-4 py-3 font-mono text-xs text-muted">{order.id.slice(0, 8)}…</td>
              <td className="px-4 py-3 font-mono text-xs text-muted">{order.buyerAddress.slice(0, 8)}…{order.buyerAddress.slice(-6)}</td>
              <td className="px-4 py-3 text-right font-medium text-foreground">{formatAmount(order.amount)} XLM</td>
              <td className="px-4 py-3 text-center"><FulfilmentState status={order.status} /></td>
              <td className="px-4 py-3 text-right text-muted">{new Date(order.createdAt).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-right"><Link href={`/campaigns/${order.campaignId}`} className="text-xs text-primary-600 hover:underline">Campaign</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FarmerDashboardPage() {
  const { address, connected } = useWallet();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    if (!address) return;
    try {
      const response = await fetchOrdersByFarmer(address);
      setOrders(filterOrdersForFarmer(response, address));
      setError(null);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load farmer orders.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (address) {
      setLoading(true);
      void loadOrders();
    }
  }, [address, loadOrders]);

  useWebSocket(
    useCallback((message: WsMessage) => {
      if (message.event === "order.created" || message.event === "order.confirmed") {
        void loadOrders();
      }
    }, [loadOrders]),
  );

  if (!connected || !address) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Farmer Dashboard</h1>
          <p className="mt-2 text-sm text-muted">Connect the wallet that owns your campaigns to manage incoming orders.</p>
        </div>
        <WalletConnect />
      </div>
    );
  }

  const summary = summarizeFarmerOrders(orders);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Farmer Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Incoming orders for <span className="font-mono">{address.slice(0, 8)}…{address.slice(-6)}</span></p>
        </div>
        <Link href="/campaigns" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">My campaigns</Link>
      </div>

      <section aria-label="Revenue summary" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5">
          <p className="text-xs text-yellow-700">Pending deliveries</p>
          <p className="mt-1 text-2xl font-semibold text-yellow-800">{summary.pendingDeliveries.length}</p>
          <p className="mt-1 text-xs text-yellow-700">{formatAmount(String(summary.pendingValue))} XLM awaiting buyer confirmation</p>
        </div>
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-5">
          <p className="text-xs text-primary-700">Completed orders</p>
          <p className="mt-1 text-2xl font-semibold text-primary-800">{summary.completedOrders.length}</p>
          <p className="mt-1 text-xs text-primary-700">Buyer receipt confirmed on the indexed order</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs text-muted">Confirmed revenue</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{formatAmount(String(summary.completedRevenue))} XLM</p>
          <p className="mt-1 text-xs text-muted">Only confirmed orders contribute to revenue</p>
        </div>
      </section>

      {/* Regional price-index widget (#696) */}
      <PriceIndexWidget />

      {lastUpdated && <p className="text-xs text-muted" aria-live="polite">Live data refreshed {new Date(lastUpdated).toLocaleTimeString()}</p>}
      {loading && <OrderTableSkeleton rows={4} />}
      {!loading && error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</div>}
      {!loading && !error && (
        <>
          <section aria-labelledby="pending-deliveries-heading">
            <h2 id="pending-deliveries-heading" className="mb-3 text-lg font-semibold text-foreground">Pending deliveries</h2>
            <FarmerOrderTable orders={summary.pendingDeliveries} label="Pending farmer deliveries" emptyText="No pending deliveries. New orders will appear here in real time." />
          </section>
          <section aria-labelledby="completed-orders-heading">
            <h2 id="completed-orders-heading" className="mb-3 text-lg font-semibold text-foreground">Completed orders</h2>
            <FarmerOrderTable orders={summary.completedOrders} label="Completed farmer orders" emptyText="No completed orders yet." />
          </section>
        </>
      )}
    </div>
  );
}
