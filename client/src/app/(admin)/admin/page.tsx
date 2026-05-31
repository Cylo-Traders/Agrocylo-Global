"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import {
  Users,
  ShoppingBag,
  Package,
  TrendingUp,
  DollarSign,
  ArrowUpRight,
  Activity,
  Shield,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatCard } from "@/components/shared/stat-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  fetchPlatformStats,
  fetchRecentActivity,
  type PlatformStats,
  type RecentActivity,
} from "@/services/adminService";

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [activity, setActivity] = useState<RecentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [statsData, activityData] = await Promise.all([
        fetchPlatformStats(),
        fetchRecentActivity(),
      ]);
      setStats(statsData);
      setActivity(activityData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data");
      setStats(null);
      setActivity([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const kpis = [
    {
      label: "Total Volume (TVL)",
      value: stats?.totalVolume ?? "—",
      change: stats ? "Total escrow value" : "Loading...",
      icon: DollarSign,
    },
    {
      label: "Platform Revenue",
      value: stats?.platformRevenue ?? "—",
      change: "3% of completed orders",
      icon: TrendingUp,
    },
    {
      label: "Total Users",
      value: stats?.totalUsers ?? "—",
      change: stats ? `${stats.totalUsers} registered` : "Loading...",
      icon: Users,
    },
    {
      label: "Active Products",
      value: stats?.totalProducts ?? "—",
      change: stats ? `${stats.totalProducts} items` : "Loading...",
      icon: Package,
    },
    {
      label: "Total Orders",
      value: stats?.totalOrders ?? "—",
      change: stats ? `${stats.totalOrders} all-time` : "Loading...",
      icon: ShoppingBag,
    },
    {
      label: "Pending Escrow",
      value: stats?.pendingEscrow ?? "—",
      change: "Open orders",
      icon: Shield,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Platform Overview"
        description={`Real-time analytics — ${new Date().toLocaleDateString(
          "en-US",
          { dateStyle: "long" },
        )}`}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="bg-secondary/50 rounded-lg border border-border h-32 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {kpis.map((kpi) => (
            <StatCard key={kpi.label} {...kpi} />
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent Activity</h2>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href="/admin/orders">
                All orders <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          <Separator className="my-4" />
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-secondary/50 rounded h-12 animate-pulse"
                />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-3 py-12 text-sm">
              <Activity className="size-8" />
              <p>No recent activity yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activity.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="border-b border-border pb-3 last:border-b-0"
                >
                  <p className="text-sm font-medium">{item.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.timestamp).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">New Users</h2>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href="/admin/users">
                All users <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          <Separator className="my-4" />
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-secondary/50 rounded h-12 animate-pulse"
                />
              ))}
            </div>
          ) : stats && stats.totalUsers > 0 ? (
            <div className="text-sm">
              <p className="text-muted-foreground">
                {stats.totalUsers} registered users on the platform
              </p>
            </div>
          ) : (
            <div className="text-muted-foreground flex flex-col items-center gap-3 py-12 text-sm">
              <Users className="size-8" />
              <p>No users yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* Sample-only block kept to demonstrate the StatusBadge rendering */}
      <div className="rounded-2xl border bg-card">
        <div className="flex items-center justify-between p-6">
          <h2 className="font-semibold">Status Reference</h2>
          <span className="text-muted-foreground text-xs">
            Visual key
          </span>
        </div>
        <Separator />
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5 sm:p-6">
          <StatusBadge status="Pending" />
          <StatusBadge status="Delivered" />
          <StatusBadge status="Completed" />
          <StatusBadge status="Refunded" />
          <StatusBadge status="Disputed" />
        </div>
      </div>
    </div>
  );
}
