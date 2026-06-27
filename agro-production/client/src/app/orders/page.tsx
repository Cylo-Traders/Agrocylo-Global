"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { fetchOrdersByBuyer, fetchOrdersByFarmer, confirmOrderReceipt } from "@/services/orderService";
import { formatAmount } from "@/services/campaignService";
import { isNetworkError } from "@/lib/apiClient";
import { OrderTableSkeleton, ButtonSpinner } from "@/components/Skeletons";
import ConfirmOrderModal from "@/components/ui/ConfirmOrderModal";
import type { Order, OrderStatus } from "@/types";

const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  CONFIRMED: "bg-primary-100 text-primary-700",
};

function OrderRow({
  order,
  buyerAddress,
  isBuyerTab,
  onConfirmClick,
}: {
  order: Order;
  buyerAddress?: string;
  isBuyerTab: boolean;
  onConfirmClick: (order: Order) => void;
}) {
  const canConfirm =
    isBuyerTab &&
    buyerAddress === order.buyerAddress &&
    order.status === "PENDING";

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface text-sm">
      <td className="px-4 py-3 font-mono text-xs text-muted">{order.id.slice(0, 8)}…</td>
      <td className="px-4 py-3 font-mono text-xs text-muted">{order.campaignId.slice(0, 8)}…</td>
      <td className="px-4 py-3 font-medium text-foreground text-right">{formatAmount(order.amount)} XLM</td>
      <td className="px-4 py-3 text-center">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[order.status]}`}>
          {order.status}
        </span>
      </td>
      <td className="px-4 py-3 text-right text-muted">
        {new Date(order.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-right space-x-2">
        <Link
          href={`/campaigns/${order.campaignId}`}
          className="text-xs text-primary-600 hover:underline"
          aria-label={`View campaign for order ${order.id.slice(0, 8)}…`}
        >
          View Campaign
        </Link>
        {canConfirm && (
          <button
            onClick={() => onConfirmClick(order)}
            className="text-xs text-primary-600 hover:underline font-medium"
            aria-label={`Confirm receipt for order ${order.id.slice(0, 8)}…`}
          >
            Confirm Receipt
          </button>
        )}
      </td>
    </tr>
  );
}

function OrderTable({
  orders,
  emptyText,
  label,
  buyerAddress,
  isBuyerTab,
  onConfirmClick,
}: {
  orders: Order[];
  emptyText: string;
  label: string;
  buyerAddress?: string;
  isBuyerTab: boolean;
  onConfirmClick: (order: Order) => void;
}) {
  if (orders.length === 0)
    return <p className="text-sm text-muted py-4 text-center">{emptyText}</p>;
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm" aria-label={label}>
        <caption className="sr-only">{label}</caption>
        <thead className="bg-surface border-b border-border">
          <tr>
            <th scope="col" className="text-left px-4 py-2 text-muted font-medium">
              Order ID
            </th>
            <th scope="col" className="text-left px-4 py-2 text-muted font-medium">
              Campaign
            </th>
            <th scope="col" className="text-right px-4 py-2 text-muted font-medium">
              Amount
            </th>
            <th scope="col" className="text-center px-4 py-2 text-muted font-medium">
              Status
            </th>
            <th scope="col" className="text-right px-4 py-2 text-muted font-medium">
              Date
            </th>
            <th scope="col" className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              buyerAddress={buyerAddress}
              isBuyerTab={isBuyerTab}
              onConfirmClick={onConfirmClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Tab = "buyer" | "farmer";

export default function OrdersPage() {
  const { address, connected, connect, loading: walletLoading } = useWallet();
  const [tab, setTab] = useState<Tab>("buyer");
  const [buyerOrders, setBuyerOrders] = useState<Order[]>([]);
  const [farmerOrders, setFarmerOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const refreshOrders = async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const [b, f] = await Promise.all([
        fetchOrdersByBuyer(address).catch(() => [] as Order[]),
        fetchOrdersByFarmer(address).catch(() => [] as Order[]),
      ]);
      setBuyerOrders(b);
      setFarmerOrders(f);
    } catch (err: unknown) {
      setError(
        isNetworkError(err)
          ? "Network error — check your connection and try again"
          : err instanceof Error
            ? err.message
            : "Failed to load orders"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!address) return;
    void refreshOrders();
  }, [address]);

  const handleConfirmReceipt = async (orderId: string) => {
    if (!address) return;
    try {
      await confirmOrderReceipt(orderId, address);
      // Refresh orders to update status
      await refreshOrders();
      setConfirmModalOpen(false);
      setSelectedOrder(null);
    } catch (err) {
      throw err;
    }
  };

  if (!connected) {
    return (
      <div className="border border-border rounded-xl p-10 text-center space-y-4">
        <p className="text-lg font-semibold text-foreground">Connect Your Wallet</p>
        <p className="text-sm text-muted">Connect to view your orders and campaign activity.</p>
        <button onClick={connect} disabled={walletLoading} aria-label={walletLoading ? "Connecting wallet" : "Connect wallet to view orders"} className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-2">{walletLoading && <ButtonSpinner />}{walletLoading ? "Connecting…" : "Connect Wallet"}</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Order Dashboard</h1>
        <Link href="/campaigns" className="text-sm bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700">Browse Campaigns</Link>
      </div>
      <nav aria-label="Order type tabs" className="flex border-b border-border">
        {(["buyer", "farmer"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} role="tab" aria-selected={tab === t} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-primary-600 text-primary-600" : "border-transparent text-muted hover:text-foreground"}`}>
            {t === "buyer" ? "My Purchases" : "My Campaigns (Farmer)"}
          </button>
        ))}
      </nav>
      {!loading && (
        <div className="flex gap-4 text-sm" aria-live="polite">
          <div className="border border-border rounded-lg px-3 py-2 bg-surface"><span className="text-muted">Buyer orders: </span><span className="font-semibold text-foreground">{buyerOrders.length}</span></div>
          <div className="border border-border rounded-lg px-3 py-2 bg-surface"><span className="text-muted">Farmer orders: </span><span className="font-semibold text-foreground">{farmerOrders.length}</span></div>
          <div className="border border-yellow-200 rounded-lg px-3 py-2 bg-yellow-50"><span className="text-muted">Pending: </span><span className="font-semibold text-yellow-700">{(tab === "buyer" ? buyerOrders : farmerOrders).filter((o) => o.status === "PENDING").length}</span></div>
        </div>
      )}
      {loading && <OrderTableSkeleton rows={3} />}
      {!loading && error && (
        <div
          className="border border-red-200 bg-red-50 rounded-xl p-4 text-red-700 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}
      {!loading && !error && tab === "buyer" && (
        <OrderTable
          orders={buyerOrders}
          emptyText="No orders found. Browse campaigns to place your first order."
          label="Buyer orders"
          buyerAddress={address ?? undefined}
          isBuyerTab={true}
          onConfirmClick={(order) => {
            setSelectedOrder(order);
            setConfirmModalOpen(true);
          }}
        />
      )}
      {!loading && !error && tab === "farmer" && (
        <OrderTable
          orders={farmerOrders}
          emptyText="No orders on your campaigns yet."
          label="Farmer orders"
          buyerAddress={address ?? undefined}
          isBuyerTab={false}
          onConfirmClick={() => {}}
        />
      )}

      <ConfirmOrderModal
        open={confirmModalOpen}
        order={selectedOrder}
        onClose={() => {
          setConfirmModalOpen(false);
          setSelectedOrder(null);
        }}
        onConfirm={handleConfirmReceipt}
      />
    </div>
  );
}
