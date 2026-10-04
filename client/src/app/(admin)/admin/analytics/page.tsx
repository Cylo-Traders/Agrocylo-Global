"use client";

import { useCallback, useMemo } from "react";
import {
  FileJson,
  FileSpreadsheet,
  Globe,
  TimerReset,
} from "lucide-react";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAnalytics } from "@/hooks/useAnalytics";
import { downloadFile, buildDailySeries, formatPercent } from "./utils";
import { AnalyticsStats } from "./components/AnalyticsStats";
import { HistoricalActivity } from "./components/HistoricalActivity";
import { PrivacyControls } from "./components/PrivacyControls";
import { FunnelsSection } from "./components/FunnelsSection";
import { FeatureUsageSection } from "./components/FeatureUsageSection";

const CategoryPieChart = dynamic(
  () => import("@/components/shared/charts").then((m) => ({ default: m.CategoryPieChart })),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> }
);

const EarningsLineChart = dynamic(
  () => import("@/components/shared/charts").then((m) => ({ default: m.EarningsLineChart })),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> }
);

const OrdersBarChart = dynamic(
  () => import("@/components/shared/charts").then((m) => ({ default: m.OrdersBarChart })),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> }
);

const UsersGrowthChart = dynamic(
  () => import("@/components/shared/charts").then((m) => ({ default: m.UsersGrowthChart })),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full" /> }
);

export default function AdminAnalyticsPage() {
  const {
    consent,
    metrics,
    events,
    snapshot,
    setConsent,
    exportJson,
    exportCsv,
    refresh,
    trackFeatureAdoption,
  } = useAnalytics();

  const dailySeries = useMemo(() => buildDailySeries(events), [events]);
  const recentEvents = useMemo(() => events.slice(-12).reverse(), [events]);
  const topFeatures = metrics.featureUsage.slice(0, 5);
  const funnelRows = useMemo(
    () =>
      Object.entries(metrics.funnels).map(([name, funnel]) => ({
        name,
        started: funnel.started,
        completed: funnel.completed,
        dropOff: funnel.started > 0 ? 1 - funnel.completed / funnel.started : 0,
        steps: funnel.steps,
      })),
    [metrics.funnels],
  );

  const revenueSeries = useMemo(
    () =>
      dailySeries.map((day) => ({
        month: day.label,
        gross: day.value * 150,
        net: day.value * 110,
      })),
    [dailySeries],
  );

  const ordersSeries = useMemo(
    () =>
      dailySeries.map((day) => ({
        month: day.label,
        completed: day.value,
        pending: Math.max(day.value - 1, 0),
        refunded: day.value > 3 ? 1 : 0,
      })),
    [dailySeries],
  );

  const userGrowthSeries = useMemo(
    () =>
      metrics.cohorts.slice(-6).map((cohort) => ({
        month: cohort.cohort,
        farmers: cohort.users,
        buyers: cohort.events,
      })),
    [metrics.cohorts],
  );

  const categorySeries = useMemo(
    () =>
      topFeatures.slice(0, 5).map((feature, index) => ({
        name: feature.feature,
        value: feature.count,
        color: ["#0ea5e9", "#22c55e", "#f59e0b", "#a855f7", "#ef4444"][index % 5],
      })),
    [topFeatures],
  );

  const handleExport = useCallback(
    (kind: "json" | "csv") => {
      trackFeatureAdoption("analytics_export", { kind });
      if (kind === "json") {
        downloadFile(
          `agrocylo-analytics-${snapshot.updatedAt.slice(0, 10)}.json`,
          exportJson(),
          "application/json",
        );
        return;
      }

      downloadFile(
        `agrocylo-analytics-${snapshot.updatedAt.slice(0, 10)}.csv`,
        exportCsv(),
        "text/csv",
      );
    },
    [exportCsv, exportJson, snapshot.updatedAt, trackFeatureAdoption],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description="Real-time user behavior, funnel health, and privacy controls."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <TimerReset className="size-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("json")}>
            <FileJson className="size-4" />
            Export JSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
            <FileSpreadsheet className="size-4" />
            Export CSV
          </Button>
        </div>
      </PageHeader>

      <AnalyticsStats metrics={metrics} />

      <div className="grid gap-6 lg:grid-cols-3">
        <HistoricalActivity events={events} consent={consent} />
        <PrivacyControls
          consent={consent}
          setConsent={setConsent}
          refresh={refresh}
          snapshot={snapshot}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <FunnelsSection funnelRows={funnelRows} />
        <FeatureUsageSection topFeatures={topFeatures} cohorts={metrics.cohorts} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Volume Over Time</h2>
          <EarningsLineChart data={revenueSeries} />
        </div>
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Order Outcomes</h2>
          <OrdersBarChart data={ordersSeries} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">User Growth</h2>
          <UsersGrowthChart data={userGrowthSeries} />
        </div>
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Product Category Performance</h2>
          <CategoryPieChart data={categorySeries} />
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Globe className="text-primary size-4" />
          <h2 className="font-semibold">Cohort Distribution</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground text-xs uppercase">
              <tr className="border-b">
                <th className="px-3 py-2 font-semibold">Cohort</th>
                <th className="px-3 py-2 font-semibold">Users</th>
                <th className="px-3 py-2 font-semibold">Events</th>
                <th className="px-3 py-2 font-semibold">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {metrics.cohorts.map((cohort) => {
                const totalUsers = metrics.cohorts.reduce((sum, item) => sum + item.users, 0);
                const share = totalUsers ? ((cohort.users / totalUsers) * 100).toFixed(1) : "0";
                return (
                  <tr key={cohort.cohort}>
                    <td className="px-3 py-3 font-medium">{cohort.cohort}</td>
                    <td className="px-3 py-3">{cohort.users.toLocaleString()}</td>
                    <td className="px-3 py-3">{cohort.events.toLocaleString()}</td>
                    <td className="px-3 py-3">{share}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <section className="rounded-2xl border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Recent Events</h2>
            <p className="text-muted-foreground text-sm">
              Latest captured interactions with anonymized metadata.
            </p>
          </div>
          <Badge variant="outline">{recentEvents.length} recent</Badge>
        </div>
        <Separator className="my-4" />
        {recentEvents.length > 0 ? (
          <div className="overflow-hidden rounded-xl border">
            <div className="grid grid-cols-4 bg-secondary/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Time</span>
              <span>Event</span>
              <span>Path</span>
              <span>Properties</span>
            </div>
            <div className="divide-y">
              {recentEvents.map((event) => (
                <div key={event.id} className="grid grid-cols-4 gap-4 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="font-medium">{event.name}</span>
                  <span className="truncate text-muted-foreground">{event.path}</span>
                  <span className="truncate text-muted-foreground">
                    {Object.entries(event.properties)
                      .map(([key, value]) => `${key}: ${String(value)}`)
                      .join(" · ") || "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
            No analytics events captured yet.
          </div>
        )}
      </section>
    </div>
  );
}
