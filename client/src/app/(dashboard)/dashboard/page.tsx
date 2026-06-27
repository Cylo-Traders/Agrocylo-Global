"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  DollarSign,
  Package,
  ShoppingBag,
  TrendingUp,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/shared/stat-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { useMyProducts } from "@/hooks/queries/useProducts";
import { useSellerOrders } from "@/hooks/queries/useOrders";

const EarningsLineChart = dynamic(
  () => import("@/components/shared/charts").then((m) => ({ default: m.EarningsLineChart })),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> }
);

const OrdersBarChart = dynamic(
  () => import("@/components/shared/charts").then((m) => ({ default: m.OrdersBarChart })),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> }
);

export default function DashboardOverviewPage() {
  // Live data from the backend; charts still use placeholder series until
  // the backend exposes historical aggregates (tracked in roadmap).
  const { data: myProductsResponse } = useMyProducts();
  const { data: orders = [] } = useSellerOrders();

  const products = myProductsResponse?.items ?? [];

  const completed = orders.filter((o) => o.status === "Completed");
  const pending = orders.filter((o) => o.status === "Pending");

  const totalRevenue = completed.reduce(
    (sum, o) => sum + Number(o.amount ?? 0) / 1e7,
    0,
  );

  const stats = [
    {
      label: "Total Revenue",
      value: `${totalRevenue.toFixed(2)} XLM`,
      icon: DollarSign,
      change:
        completed.length > 0
          ? `${completed.length} completed orders`
          : "No completed orders yet",
    },
    {
      label: "Active Products",
      value: products.filter((p) => p.is_available).length,
      icon: Package,
      change: `${products.length} total listed`,
    },
    {
      label: "Total Orders",
      value: orders.length,
      icon: ShoppingBag,
      change: `${pending.length} awaiting confirmation`,
    },
    {
      label: "Pending Orders",
      value: pending.length,
      icon: TrendingUp,
      change: pending.length > 0 ? "Needs attention" : "All clear",
    },
  ];

  // Placeholder series — real time-series data will plug in once the backend
  // exposes monthly aggregates.
  const earningsData = [
    { month: "Jan", gross: 0, net: 0 },
    { month: "Feb", gross: 0, net: 0 },
    { month: "Mar", gross: 0, net: 0 },
    { month: "Apr", gross: 0, net: 0 },
    { month: "May", gross: 0, net: 0 },
    { month: "Jun", gross: totalRevenue, net: totalRevenue * 0.97 },
  ];

  const ordersChart = [
    {
      month: "Jun",
      completed: completed.length,
      pending: pending.length,
      refunded: orders.filter((o) => o.status === "Refunded").length,
    },
  ];

  const recentOrders = orders.slice(0, 3);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Welcome back! Here's your farm overview."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Earnings Overview</h2>
          <EarningsLineChart data={earningsData} />
        </div>
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Orders Breakdown</h2>
          <OrdersBarChart data={ordersChart} />
        </div>
      </div>

      <div className="rounded-2xl border bg-card">
        <div className="flex items-center justify-between p-6">
          <h2 className="font-semibold">Recent Orders</h2>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/dashboard/orders">
              View All <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
        <Separator />
        {recentOrders.length === 0 ? (
          <div className="text-muted-foreground p-6 text-sm">
            No orders yet — once buyers place orders, they&apos;ll show up here.
          </div>
        ) : (
          <div className="divide-y">
            {recentOrders.map((order) => (
              <div
                key={order.orderId}
                className="flex items-center justify-between px-6 py-4"
              >
                <div>
                  <p className="text-sm font-medium">Order #{order.orderId}</p>
                  <p className="text-muted-foreground text-xs">
                    {order.buyer?.slice(0, 6)}…{order.buyer?.slice(-4)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <StatusBadge status={order.status} />
                  <span className="text-sm font-semibold">
                    {(Number(order.amount ?? 0) / 1e7).toFixed(2)} XLM
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
