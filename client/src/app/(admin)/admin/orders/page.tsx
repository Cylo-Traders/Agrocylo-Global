"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRight, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import type { Order } from "@/types/order";
import { fetchAdminOrders } from "@/services/adminService";

const columns: ColumnDef<Order>[] = [
  {
    accessorKey: "orderId",
    header: "Order",
    cell: ({ getValue }) => (
      <span className="text-sm font-medium">#{String(getValue())}</span>
    ),
  },
  {
    accessorKey: "buyer",
    header: "Buyer",
    cell: ({ getValue }) => {
      const v = String(getValue() ?? "");
      return (
        <span className="font-mono text-xs">
          {v ? `${v.slice(0, 6)}…${v.slice(-4)}` : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "seller",
    header: "Seller",
    cell: ({ getValue }) => {
      const v = String(getValue() ?? "");
      return (
        <span className="font-mono text-xs">
          {v ? `${v.slice(0, 6)}…${v.slice(-4)}` : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "amount",
    header: "Amount",
    enableGlobalFilter: false,
    cell: ({ getValue }) => (
      <span className="text-sm font-medium">
        {(Number(getValue() ?? 0) / 1e7).toFixed(2)} XLM
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
    accessorKey: "createdAt",
    header: "Created",
    enableGlobalFilter: false,
    cell: ({ getValue }) => {
      const v = Number(getValue());
      if (!v) return <span>—</span>;
      return (
        <span className="text-muted-foreground text-sm">
          {new Date(v * 1000).toLocaleDateString()}
        </span>
      );
    },
  },
  {
    id: "actions",
    header: "",
    enableGlobalFilter: false,
    enableSorting: false,
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm" className="gap-1">
        <Link href={`/orders/${row.original.orderId}`}>
          View <ArrowUpRight className="size-3.5" />
        </Link>
      </Button>
    ),
  },
];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const ordersData = await fetchAdminOrders();
      setOrders(ordersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="All Orders"
        description="Every order placed across the platform."
      />

      {error && (
        <div className="bg-destructive/10 border-destructive/30 flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
          <Button
            onClick={() => void loadData()}
            variant="outline"
            size="sm"
          >
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="bg-secondary/50 rounded-2xl border h-96 animate-pulse" />
      ) : orders.length === 0 ? (
        <div className="bg-card rounded-2xl border p-10 text-center">
          <h3 className="text-lg font-semibold">No orders to show yet</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            No orders have been placed on the platform.
          </p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={orders}
          searchPlaceholder="Search by order, buyer, or seller…"
        />
      )}
    </div>
  );
}
