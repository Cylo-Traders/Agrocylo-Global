"use client";

import dynamic from "next/dynamic";
import { DollarSign, TrendingUp, Clock } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";

import { StatCard } from "@/components/shared/stat-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/shared/data-table";
import { useSellerOrders } from "@/hooks/queries/useOrders";
import type { Order } from "@/types/order";

const EarningsLineChart = dynamic(
  () => import("@/components/shared/charts").then((m) => ({ default: m.EarningsLineChart })),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> }
);

const PLATFORM_FEE = 0.03;

interface Payout {
  orderId: string;
  buyer: string;
  gross: number;
  fee: number;
  net: number;
  status: string;
  date: string;
}

const columns: ColumnDef<Payout>[] = [
  {
    accessorKey: "orderId",
    header: "Order",
    cell: ({ getValue }) => (
      <span className="text-sm font-medium">#{String(getValue())}</span>
    ),
  },
  {
    accessorKey: "gross",
    header: "Gross",
    enableGlobalFilter: false,
    cell: ({ getValue }) => (
      <span className="text-sm">{Number(getValue()).toFixed(2)} XLM</span>
    ),
  },
  {
    accessorKey: "fee",
    header: "Platform Fee",
    enableGlobalFilter: false,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground text-sm">
        {Number(getValue()).toFixed(2)} XLM
      </span>
    ),
  },
  {
    accessorKey: "net",
    header: "Net",
    enableGlobalFilter: false,
    cell: ({ getValue }) => (
      <span className="text-sm font-semibold">
        {Number(getValue()).toFixed(2)} XLM
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    enableGlobalFilter: false,
    cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
  },
  {
    accessorKey: "date",
    header: "Date",
    enableGlobalFilter: false,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground text-sm">{String(getValue())}</span>
    ),
  },
];

function orderToPayout(o: Order): Payout {
  const gross = Number(o.amount ?? 0) / 1e7;
  const fee = gross * PLATFORM_FEE;
  return {
    orderId: o.orderId,
    buyer: o.buyer ?? "",
    gross,
    fee,
    net: gross - fee,
    status: o.status,
    date: o.createdAt
      ? new Date(Number(o.createdAt) * 1000).toLocaleDateString()
      : "—",
  };
}

export default function EarningsDashboard() {
  const { data: orders = [], isLoading } = useSellerOrders();

  const payouts = orders.map(orderToPayout);

  const totalEarned = payouts
    .filter((p) => p.status === "Completed")
    .reduce((s, p) => s + p.net, 0);
  const pendingEarnings = payouts
    .filter((p) => p.status === "Pending")
    .reduce((s, p) => s + p.net, 0);
  const totalFees = payouts
    .filter((p) => p.status === "Completed")
    .reduce((s, p) => s + p.fee, 0);

  // Placeholder series — will be backed by real monthly aggregates later.
  const monthlyData = [
    { month: "Jan", gross: 0, net: 0 },
    { month: "Feb", gross: 0, net: 0 },
    { month: "Mar", gross: 0, net: 0 },
    {
      month: "Now",
      gross: totalEarned + totalFees,
      net: totalEarned,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Earnings"
        description="Your settled and pending payouts after the 3% platform fee."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Earned"
          value={`${totalEarned.toFixed(2)} XLM`}
          icon={DollarSign}
          change="Settled to your wallet"
        />
        <StatCard
          label="Pending"
          value={`${pendingEarnings.toFixed(2)} XLM`}
          icon={Clock}
          change="Awaiting buyer confirmation"
        />
        <StatCard
          label="Platform Fees Paid"
          value={`${totalFees.toFixed(2)} XLM`}
          icon={TrendingUp}
          change="3% on completed orders"
        />
      </div>

      <div className="rounded-2xl border bg-card p-6">
        <h2 className="mb-4 font-semibold">Earnings Overview</h2>
        <EarningsLineChart data={monthlyData} />
      </div>

      <div>
        <h2 className="mb-4 font-semibold">Payout History</h2>
        {isLoading ? (
          <div className="bg-card text-muted-foreground rounded-2xl border p-10 text-center text-sm">
            Loading payouts…
          </div>
        ) : payouts.length === 0 ? (
          <div className="bg-card rounded-2xl border p-10 text-center">
            <h3 className="text-lg font-semibold">No payouts yet</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Your first payout will land here once a buyer confirms delivery.
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={payouts}
            searchPlaceholder="Search by order ID…"
          />
        )}
      </div>
    </div>
  );
}
