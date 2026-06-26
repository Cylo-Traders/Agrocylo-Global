"use client";

import { useCallback, useMemo } from "react";
import {
  AlertCircle,
  BarChart3,
  FileJson,
  FileSpreadsheet,
  Globe,
  LineChart,
  ShoppingBag,
  ShieldCheck,
  Sparkles,
  TimerReset,
  TrendingUp,
  Users,
} from "lucide-react";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

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
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAnalytics } from "@/hooks/useAnalytics";

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildDailySeries(
  events: Array<{ timestamp: string; name: string }>,
  days = 7,
) {
  const map = new Map<string, number>();
  const now = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - i);
    map.set(day.toISOString().slice(0, 10), 0);
  }

  for (const event of events) {
    const key = event.timestamp.slice(0, 10);
    if (map.has(key)) {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }

  return Array.from(map.entries()).map(([day, value]) => ({
    day,
    label: new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    value,
  }));
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Engagement Score"
          value={metrics.engagementScore}
          change="Composite of views, interactions, and funnel activity"
          icon={Sparkles}
        />
        <StatCard
          label="Conversion Rate"
          value={formatPercent(metrics.conversionRate)}
          change="Completion rate across tracked funnels"
          icon={BarChart3}
        />
        <StatCard
          label="Page Views"
          value={metrics.pageViews}
          change={`${metrics.uniquePages} unique pages`}
          icon={LineChart}
        />
        <StatCard
          label="Tracked Events"
          value={metrics.totalEvents}
          change={`${metrics.sessionEvents} event records`}
          icon={Users}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border bg-card p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Historical Activity</h2>
              <p className="text-muted-foreground text-sm">
                Daily event volume for the last 7 days.
              </p>
            </div>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="size-3.5" />
              {consent}
            </Badge>
          </div>
          <Separator className="my-4" />
          <div className="grid grid-cols-7 gap-2">
            {dailySeries.map((day) => {
              const max = Math.max(...dailySeries.map((item) => item.value), 1);
              const height = `${Math.max((day.value / max) * 100, 8)}%`;
              return (
                <div key={day.day} className="flex min-h-40 flex-col gap-2">
                  <div className="flex flex-1 items-end">
                    <div
                      className="bg-primary/80 hover:bg-primary w-full rounded-t-xl transition-all"
                      style={{ height }}
                      title={`${day.label}: ${day.value} events`}
                    />
                  </div>
                  <div className="text-center text-[11px] text-muted-foreground">
                    <div>{day.label}</div>
                    <div className="font-medium text-foreground">{day.value}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Privacy Controls</h2>
              <p className="text-muted-foreground text-sm">
                Enable or disable local analytics on this device.
              </p>
            </div>
          </div>
          <Separator className="my-4" />
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
              <div>
                <p className="font-medium">Collection</p>
                <p className="text-muted-foreground text-sm">
                  Consent is stored locally and respected across reloads.
                </p>
              </div>
              <Switch
                checked={consent === "granted"}
                onCheckedChange={(checked) => setConsent(checked ? "granted" : "denied")}
              />
            </div>
            <div className="rounded-xl bg-secondary/40 p-4 text-sm">
              <p className="font-medium">Latest snapshot</p>
              <p className="text-muted-foreground mt-1">
                Updated at {new Date(snapshot.updatedAt).toLocaleString()}.
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={() => void refresh()}>
              Refresh live metrics
            </Button>
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-6">
          <h2 className="text-lg font-semibold">Funnels</h2>
          <p className="text-muted-foreground text-sm">
            Product discovery, purchase, barter creation, and onboarding.
          </p>
          <Separator className="my-4" />
          <div className="space-y-4">
            {funnelRows.map((row) => (
              <div key={row.name} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium capitalize">
                      {row.name.replaceAll("_", " ")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {row.started} started · {row.completed} completed
                    </p>
                  </div>
                  <Badge variant={row.dropOff > 0.5 ? "destructive" : "secondary"}>
                    {formatPercent(1 - row.dropOff)}
                  </Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {row.steps.length > 0 ? (
                    row.steps.map((step) => (
                      <div key={step.step} className="flex items-center gap-3 text-xs">
                        <span className="text-muted-foreground w-28 shrink-0">
                          {step.step}
                        </span>
                        <div className="bg-secondary h-2 flex-1 rounded-full">
                          <div
                            className="bg-primary h-2 rounded-full"
                            style={{
                              width: `${Math.max(
                                (step.count / Math.max(row.started || 1, step.count)) * 100,
                                6,
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="w-10 text-right font-medium">{step.count}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      No funnel activity yet.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-6">
          <h2 className="text-lg font-semibold">Feature Usage</h2>
          <p className="text-muted-foreground text-sm">
            Features with the highest adoption in the current snapshot.
          </p>
          <Separator className="my-4" />
          <div className="space-y-3">
            {topFeatures.length > 0 ? (
              topFeatures.map((feature) => (
                <div key={feature.feature} className="flex items-center gap-3">
                  <div className="text-muted-foreground w-36 shrink-0 text-sm">
                    {feature.feature}
                  </div>
                  <div className="bg-secondary h-2 flex-1 rounded-full">
                    <div
                      className="bg-primary h-2 rounded-full"
                      style={{
                        width: `${Math.max((feature.count / topFeatures[0].count) * 100, 8)}%`,
                      }}
                    />
                  </div>
                  <div className="w-10 text-right text-sm font-medium">{feature.count}</div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">
                No feature adoption events captured yet.
              </p>
            )}
          </div>

          <Separator className="my-4" />

          <h3 className="text-sm font-semibold">Cohorts</h3>
          <div className="mt-3 space-y-2">
            {metrics.cohorts.length > 0 ? (
              metrics.cohorts.slice(-5).reverse().map((cohort) => (
                <div key={cohort.cohort} className="flex items-center justify-between text-sm">
                  <span>{cohort.cohort}</span>
                  <span className="text-muted-foreground">
                    {cohort.users} users · {cohort.events} events
                  </span>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">No cohorts yet.</p>
            )}
          </div>
        </section>
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
