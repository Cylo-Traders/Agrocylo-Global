"use client";

/**
 * Dashboard Overview Page
 *
 * Issue #1013: Gated on the explicit wallet/auth/network readiness state machine
 * via DashboardReadinessGate. Private data is never queried using only an
 * unverified address; each missing prerequisite has exactly one actionable
 * recovery card.
 *
 * Issue #1015: Typed load-state model with retry, stale-data preservation, and
 * a non-blocking pending-indexer banner for confirmed-but-unindexed
 * transactions.
 */

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  DollarSign,
  Package,
  ShoppingBag,
  TrendingUp,
  ArrowUpRight,
  RefreshCw,
  AlertCircle,
  Loader2,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/shared/stat-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { DashboardReadinessGate } from "@/components/DashboardReadinessGate";
import { useMyProducts } from "@/hooks/queries/useProducts";
import {
  buildMonthlyOrderBuckets,
  useSellerOrders,
} from "@/hooks/queries/useOrders";

const EarningsLineChart = dynamic(
  () => import("@/components/shared/charts").then((m) => ({ default: m.EarningsLineChart })),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> }
);

const OrdersBarChart = dynamic(
  () => import("@/components/shared/charts").then((m) => ({ default: m.OrdersBarChart })),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> }
);

/** Stat card skeleton shown while data is loading (Issue #1015). */
function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border bg-card p-6 space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

/** Honest empty state for charts with no real data (Issue #1473). */
function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

/** Non-blocking error banner with retry action (Issue #1015). */
function DataErrorBanner({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="assertive"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <span className="flex items-center gap-2">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        {message}
      </span>
      <Button
        id="dashboard-retry-btn"
        size="sm"
        variant="outline"
        onClick={onRetry}
        disabled={retrying}
        className="gap-2 shrink-0"
        aria-label="Retry loading dashboard data"
      >
        {retrying ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="size-3.5" aria-hidden="true" />
        )}
        Retry
      </Button>
    </div>
  );
}

/** Pending-indexer row: transaction confirmed on-chain but not yet projected (Issue #1015). */
function PendingIndexRow({ txHash }: { txHash?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between px-6 py-4"
    >
      <div>
        <p className="text-sm font-medium">Transaction confirmed</p>
        <p className="text-muted-foreground text-xs">
          {txHash ? (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              View on explorer
            </a>
          ) : (
            "Waiting for indexer…"
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="size-3.5" aria-hidden="true" />
        Indexing…
      </div>
    </div>
  );
}

function DashboardContent() {
  // Issue #1015: use isLoading, isError, refetch, and isFetching for typed
  // load-state model. Last-good data is preserved via staleTime in useQuery.
  const {
    data: myProductsResponse,
    isLoading: productsLoading,
    isError: productsError,
    isFetching: productsFetching,
    refetch: refetchProducts,
  } = useMyProducts();

  const {
    data: orders = [],
    isLoading: ordersLoading,
    isError: ordersError,
    isFetching: ordersFetching,
    refetch: refetchOrders,
  } = useSellerOrders();

  const isLoading = productsLoading || ordersLoading;
  const hasError = productsError || ordersError;
  const isRetrying = productsFetching || ordersFetching;

  const handleRetry = () => {
    void refetchProducts();
    void refetchOrders();
  };

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

  // Issue #1473: chart buckets come from real order timestamps, not placeholders.
  const monthlyBuckets = buildMonthlyOrderBuckets(orders);
  const chartRange =
    monthlyBuckets.length > 0
      ? `${monthlyBuckets[0].month} – ${monthlyBuckets[monthlyBuckets.length - 1].month} (UTC)`
      : null;

  const recentOrders = orders.slice(0, 3);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Welcome back! Here's your farm overview."
      />

      {/* Issue #1015: Non-blocking error banner with retry – last-good data
          stays visible so the page is still usable. */}
      {hasError && !isLoading && (
        <DataErrorBanner
          message={
            ordersError && productsError
              ? "Could not load orders or products. Your last data is shown below."
              : ordersError
              ? "Could not load orders. Your last data is shown below."
              : "Could not load products. Your last data is shown below."
          }
          onRetry={handleRetry}
          retrying={isRetrying}
        />
      )}

      {/* Issue #1015: Skeleton stat cards while loading. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
          : stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <div className="min-w-0 overflow-hidden rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="font-semibold">Earnings Overview</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {chartRange ?? "No order history yet"}
          </p>
          {isLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : completed.length > 0 ? (
            <EarningsLineChart data={monthlyBuckets} />
          ) : (
            <ChartEmptyState message="No completed sales yet. Earnings will appear here once orders are completed." />
          )}
        </div>
        <div className="min-w-0 overflow-hidden rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="font-semibold">Orders Breakdown</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {chartRange ?? "No order history yet"}
          </p>
          {isLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : monthlyBuckets.length > 0 ? (
            <OrdersBarChart data={monthlyBuckets} />
          ) : (
            <ChartEmptyState message="No orders yet. Monthly order activity will appear here." />
          )}
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
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : recentOrders.length === 0 ? (
          /* Issue #1015: distinguish empty portfolio from unavailable/syncing. */
          hasError ? null : (
            <div className="text-muted-foreground p-6 text-sm">
              No orders yet — once buyers place orders, they&apos;ll show up here.
            </div>
          )
        ) : (
          <div className="divide-y">
            {/* Issue #1015: pending-indexer rows for confirmed-but-unindexed txns. */}
            {recentOrders.map((order) =>
              order.status === "PENDING_INDEX" ? (
                <PendingIndexRow key={order.orderId} txHash={order.txHash} />
              ) : (
                <div
                  key={order.orderId}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6"
                >
                  <div>
                    <p className="text-sm font-medium">Order #{order.orderId}</p>
                    <p className="text-muted-foreground text-xs">
                      {order.buyer?.slice(0, 6)}…{order.buyer?.slice(-4)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                    <StatusBadge status={order.status} />
                    <span className="text-sm font-semibold">
                      {(Number(order.amount ?? 0) / 1e7).toFixed(2)} XLM
                    </span>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardOverviewPage() {
  return (
    // Issue #1013: Gate on wallet/auth/network readiness before any private
    // data is fetched. DashboardContent is only mounted when the full
    // prerequisite chain passes.
    <DashboardReadinessGate>
      <DashboardContent />
    </DashboardReadinessGate>
  );
}
