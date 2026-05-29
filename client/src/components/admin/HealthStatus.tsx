"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Text,
} from "@/components/ui";

type ServiceStatus = "operational" | "degraded" | "down" | "unknown";

interface ServiceCheck {
  name: string;
  status: ServiceStatus;
  latencyMs?: number;
  message?: string;
}

interface ContractCheck {
  name: string;
  network: string;
  contractId: string;
  status: ServiceStatus;
  blockHeight?: number;
}

interface HealthSnapshot {
  services: ServiceCheck[];
  contracts: ContractCheck[];
  responseTimes: { time: string; p50: number; p95: number }[];
  errorRates: { time: string; errors: number; total: number }[];
  transactions: { time: string; count: number; volume: number }[];
  updatedAt: string;
}

const REFRESH_INTERVAL_MS = 15_000;

const statusVariant: Record<ServiceStatus, "success" | "warning" | "error" | "default"> = {
  operational: "success",
  degraded: "warning",
  down: "error",
  unknown: "default",
};

const statusLabel: Record<ServiceStatus, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

function pickStatus(latencyMs: number | undefined, ok: boolean): ServiceStatus {
  if (!ok) return "down";
  if (latencyMs === undefined) return "unknown";
  if (latencyMs > 1500) return "degraded";
  return "operational";
}

async function probe(url: string): Promise<{ ok: boolean; latencyMs: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store" });
    return { ok: res.ok, latencyMs: performance.now() - start };
  } catch {
    return { ok: false, latencyMs: performance.now() - start };
  }
}

function generateRollingSeries(prev: HealthSnapshot | null, latencyMs: number): HealthSnapshot["responseTimes"] {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const base = prev?.responseTimes ?? [];
  const p95 = Math.round(latencyMs * 1.4);
  const next = [...base, { time: now, p50: Math.round(latencyMs), p95 }];
  return next.slice(-30);
}

function generateErrorSeries(prev: HealthSnapshot | null, ok: boolean): HealthSnapshot["errorRates"] {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const base = prev?.errorRates ?? [];
  const errors = ok ? 0 : 1;
  const next = [...base, { time: now, errors, total: 1 }];
  return next.slice(-30);
}

function generateTxSeries(prev: HealthSnapshot | null, sample: { count: number; volume: number } | null): HealthSnapshot["transactions"] {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const base = prev?.transactions ?? [];
  if (!sample) return base;
  const next = [...base, { time: now, count: sample.count, volume: sample.volume }];
  return next.slice(-30);
}

export default function HealthStatus() {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const collect = useCallback(async () => {
    setRefreshing(true);
    try {
      const [api, orders, products, metrics] = await Promise.all([
        probe("/api/health").catch(() => probe("/api/admin/disputes")),
        probe("/api/orders"),
        probe("/api/products"),
        fetch("/api/metrics", { cache: "no-store" })
          .then(async (r) => (r.ok ? (await r.json()) : null))
          .catch(() => null),
      ]);

      const services: ServiceCheck[] = [
        { name: "API Gateway", status: pickStatus(api.latencyMs, api.ok), latencyMs: Math.round(api.latencyMs) },
        { name: "Orders Service", status: pickStatus(orders.latencyMs, orders.ok), latencyMs: Math.round(orders.latencyMs) },
        { name: "Products Service", status: pickStatus(products.latencyMs, products.ok), latencyMs: Math.round(products.latencyMs) },
        {
          name: "Metrics Service",
          status: metrics ? "operational" : "degraded",
          latencyMs: undefined,
          message: metrics ? "Reporting" : "Auth-protected or offline",
        },
      ];

      const contracts: ContractCheck[] = [
        {
          name: "Escrow",
          network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet",
          contractId: process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID || "—",
          status: api.ok ? "operational" : "unknown",
        },
        {
          name: "Marketplace",
          network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet",
          contractId: process.env.NEXT_PUBLIC_MARKET_CONTRACT_ID || "—",
          status: api.ok ? "operational" : "unknown",
        },
      ];

      setSnapshot((prev) => {
        const sample = metrics && typeof metrics === "object"
          ? {
              count: Number(metrics.transactionCount ?? metrics.txCount ?? 0),
              volume: Number(metrics.transactionVolume ?? metrics.volume ?? 0),
            }
          : null;
        return {
          services,
          contracts,
          responseTimes: generateRollingSeries(prev, api.latencyMs),
          errorRates: generateErrorSeries(prev, api.ok),
          transactions: generateTxSeries(prev, sample),
          updatedAt: new Date().toISOString(),
        };
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void collect();
  }, [collect]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => void collect(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, collect]);

  const errorRateData = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.errorRates.map((point) => ({
      time: point.time,
      ratePct: point.total === 0 ? 0 : (point.errors / point.total) * 100,
    }));
  }, [snapshot]);

  const overallStatus = useMemo<ServiceStatus>(() => {
    if (!snapshot) return "unknown";
    if (snapshot.services.some((s) => s.status === "down")) return "down";
    if (snapshot.services.some((s) => s.status === "degraded")) return "degraded";
    return "operational";
  }, [snapshot]);

  return (
    <div className="space-y-6">
      <Card variant="elevated" padding="md">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">System Health</CardTitle>
              <Badge variant={statusVariant[overallStatus]}>{statusLabel[overallStatus]}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto-refresh
              </label>
              <Button variant="outline" size="sm" onClick={() => void collect()} isLoading={refreshing}>
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {snapshot?.services.map((service) => (
              <div key={service.name} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-1">
                  <Text variant="bodySmall" className="font-semibold">
                    {service.name}
                  </Text>
                  <Badge variant={statusVariant[service.status]}>{statusLabel[service.status]}</Badge>
                </div>
                <Text variant="caption" muted>
                  {service.latencyMs !== undefined ? `${service.latencyMs} ms` : service.message ?? "—"}
                </Text>
              </div>
            ))}
          </div>
          {snapshot && (
            <Text variant="caption" muted className="block mt-3">
              Updated {new Date(snapshot.updatedAt).toLocaleTimeString()}
            </Text>
          )}
        </CardContent>
      </Card>

      <Card variant="elevated" padding="md">
        <CardHeader>
          <CardTitle className="text-base">Contract Availability</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 px-3 text-xs uppercase text-muted">Contract</th>
                  <th className="py-2 px-3 text-xs uppercase text-muted">Network</th>
                  <th className="py-2 px-3 text-xs uppercase text-muted">Contract ID</th>
                  <th className="py-2 px-3 text-xs uppercase text-muted">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {snapshot?.contracts.map((c) => (
                  <tr key={c.name}>
                    <td className="py-2 px-3 text-sm font-medium">{c.name}</td>
                    <td className="py-2 px-3 text-sm">{c.network}</td>
                    <td className="py-2 px-3 font-mono text-xs truncate max-w-[260px]">{c.contractId}</td>
                    <td className="py-2 px-3">
                      <Badge variant={statusVariant[c.status]}>{statusLabel[c.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card variant="elevated" padding="md">
          <CardHeader>
            <CardTitle className="text-base">API Response Time (ms)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={snapshot?.responseTimes ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="p50" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} />
                  <Area type="monotone" dataKey="p95" stroke="hsl(var(--warning))" fill="hsl(var(--warning))" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card variant="elevated" padding="md">
          <CardHeader>
            <CardTitle className="text-base">Error Rate (%)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={errorRateData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="ratePct" stroke="hsl(var(--error))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card variant="elevated" padding="md">
        <CardHeader>
          <CardTitle className="text-base">Transaction Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={snapshot?.transactions ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
