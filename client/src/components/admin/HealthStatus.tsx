"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  collectHealthSample,
  type HealthSnapshot,
  type ServiceStatus,
} from "@/services/adminService";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 15_000;

const statusVariant: Record<
  ServiceStatus,
  "default" | "secondary" | "destructive" | "outline" | "success"
> = {
  operational: "success",
  degraded: "secondary",
  down: "destructive",
  unknown: "outline",
};

const statusLabel: Record<ServiceStatus, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    fontSize: "12px",
    color: "var(--color-foreground)",
  },
};

export function HealthStatus() {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const next = await collectHealthSample(snapshot);
      setSnapshot(next);
    } finally {
      setIsRefreshing(false);
    }
  }, [snapshot]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, refresh]);

  const overall: ServiceStatus = !snapshot
    ? "unknown"
    : snapshot.services.some((s) => s.status === "down")
      ? "down"
      : snapshot.services.some((s) => s.status === "degraded")
        ? "degraded"
        : "operational";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Activity className="text-primary size-4" />
            </div>
            <div>
              <h2 className="font-semibold">System Health</h2>
              <p className="text-xs text-muted-foreground">
                Last updated{" "}
                {snapshot
                  ? new Date(snapshot.updatedAt).toLocaleTimeString()
                  : "—"}
              </p>
            </div>
            <Badge variant={statusVariant[overall]} className="ml-2">
              {statusLabel[overall]}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
              <Label htmlFor="auto-refresh" className="text-xs">
                Auto refresh
              </Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  isRefreshing && "animate-spin",
                )}
              />
              Refresh
            </Button>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {snapshot?.services.map((service) => (
            <div
              key={service.name}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{service.name}</span>
                <Badge variant={statusVariant[service.status]}>
                  {statusLabel[service.status]}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {service.latencyMs !== undefined
                  ? `${service.latencyMs} ms`
                  : (service.message ?? "—")}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-6">
        <h2 className="mb-4 font-semibold">Contract Availability</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 text-xs uppercase text-muted-foreground">
                  Contract
                </th>
                <th className="py-2 text-xs uppercase text-muted-foreground">
                  Network
                </th>
                <th className="py-2 text-xs uppercase text-muted-foreground">
                  Contract ID
                </th>
                <th className="py-2 text-xs uppercase text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {snapshot?.contracts.map((c) => (
                <tr key={c.name}>
                  <td className="py-3 font-medium">{c.name}</td>
                  <td className="py-3">{c.network}</td>
                  <td className="max-w-[260px] truncate py-3 font-mono text-xs">
                    {c.contractId}
                  </td>
                  <td className="py-3">
                    <Badge variant={statusVariant[c.status]}>
                      {statusLabel[c.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">API Response Time (ms)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart
              data={snapshot?.responseTimes ?? []}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
              />
              <XAxis
                dataKey="time"
                tick={{
                  fontSize: 11,
                  fill: "var(--color-muted-foreground)",
                }}
              />
              <YAxis
                tick={{
                  fontSize: 11,
                  fill: "var(--color-muted-foreground)",
                }}
              />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="p50"
                name="p50"
                stroke="var(--color-primary)"
                fill="var(--color-primary)"
                fillOpacity={0.25}
              />
              <Area
                type="monotone"
                dataKey="p95"
                name="p95"
                stroke="#f59e0b"
                fill="#f59e0b"
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Error Rate (%)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={snapshot?.errorRates ?? []}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
              />
              <XAxis
                dataKey="time"
                tick={{
                  fontSize: 11,
                  fill: "var(--color-muted-foreground)",
                }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{
                  fontSize: 11,
                  fill: "var(--color-muted-foreground)",
                }}
              />
              <Tooltip {...tooltipStyle} />
              <Line
                type="monotone"
                dataKey="ratePct"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-6">
        <h2 className="mb-4 font-semibold">Transaction Volume</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={snapshot?.transactions ?? []}
            margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
            />
            <XAxis
              dataKey="time"
              tick={{
                fontSize: 11,
                fill: "var(--color-muted-foreground)",
              }}
            />
            <YAxis
              tick={{
                fontSize: 11,
                fill: "var(--color-muted-foreground)",
              }}
            />
            <Tooltip {...tooltipStyle} />
            <Bar
              dataKey="count"
              fill="var(--color-primary)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default HealthStatus;
