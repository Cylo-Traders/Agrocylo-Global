"use client";

import { useMemo } from "react";
import {
  FileJson,
  FileSpreadsheet,
  LineChart,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Users,
  BarChart3,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  BarChart3,
  Globe,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    const key = day.toISOString().slice(0, 10);
    map.set(key, 0);
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
import {
  CategoryPieChart,
  EarningsLineChart,
  OrdersBarChart,
  UsersGrowthChart,
} from "@/components/shared/charts";
import {
  fetchAnalyticsData,
  fetchExtendedAnalytics,
  type AnalyticsData,
  type ExtendedAnalytics,
} from "@/services/adminService";

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [extended, setExtended] = useState<ExtendedAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [analytics, ext] = await Promise.all([
        fetchAnalyticsData(),
        fetchExtendedAnalytics(),
      ]);
      setData(analytics);
      setExtended(ext);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load analytics data",
      );
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const series =
    data?.series ??
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((m) => ({
      month: m,
      gross: 0,
      net: 0,
    }));

  const ordersSeries = data?.ordersSeries ?? ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((m) => ({
    month: m,
    completed: 0,
    pending: 0,
    refunded: 0,
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

  const funnelRows = Object.entries(metrics.funnels).map(([name, funnel]) => {
    const dropOff = funnel.started > 0 ? 1 - funnel.completed / funnel.started : 0;
    return {
      name,
      started: funnel.started,
      completed: funnel.completed,
      dropOff,
      steps: funnel.steps,
    };
  });

  function handleExport(kind: "json" | "csv") {
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
  }
  const ordersSeries =
    data?.ordersSeries ??
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((m) => ({
      month: m,
      completed: 0,
      pending: 0,
      refunded: 0,
    }));

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
        description="Platform-wide trends, growth, and revenue breakdowns."
      />

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-secondary/50 rounded-lg border border-border h-32 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Monthly Volume"
            value={data?.monthlyVolume ?? "—"}
            change="Last 30 days"
            icon={TrendingUp}
          />
          <StatCard
            label="Conversion Rate"
            value={data?.conversionRate ?? "—"}
            change="Order completion %"
            icon={BarChart3}
          />
          <StatCard
            label="New Users"
            value={data?.newUsers ?? "—"}
            change="Past 30 days"
            icon={Users}
          />
          <StatCard
            label="Orders Today"
            value={data?.ordersToday ?? "—"}
            change="Today's orders"
            icon={ShoppingBag}
          />
        </div>
      )}

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
                onCheckedChange={(checked) =>
                  setConsent(checked ? "granted" : "denied")
                }
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
                              width: `${Math.max((step.count / Math.max(row.started || 1, step.count)) * 100, 6)}%`,
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
                  <div className="w-10 text-right text-sm font-medium">
                    {feature.count}
                  </div>
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
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Volume Over Time</h2>
          {isLoading ? (
            <div className="bg-secondary/50 rounded-lg h-64 animate-pulse" />
          ) : (
            <EarningsLineChart data={series} />
          )}
        </div>
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Order Outcomes</h2>
          {isLoading ? (
            <div className="bg-secondary/50 rounded-lg h-64 animate-pulse" />
          ) : (
            <OrdersBarChart data={ordersSeries} />
          )}
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
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">User Growth</h2>
          {isLoading || !extended ? (
            <div className="bg-secondary/50 rounded-lg h-64 animate-pulse" />
          ) : (
            <UsersGrowthChart data={extended.userGrowth} />
          )}
        </div>
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Product Category Performance</h2>
          {isLoading || !extended ? (
            <div className="bg-secondary/50 rounded-lg h-64 animate-pulse" />
          ) : (
            <CategoryPieChart data={extended.categoryPerformance} />
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Globe className="text-primary size-4" />
          <h2 className="font-semibold">Geographic Distribution</h2>
        </div>
        {isLoading || !extended ? (
          <div className="bg-secondary/50 rounded-lg h-40 animate-pulse" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground text-xs uppercase">
                <tr className="border-b">
                  <th className="px-3 py-2 font-semibold">Region</th>
                  <th className="px-3 py-2 font-semibold">Users</th>
                  <th className="px-3 py-2 font-semibold">Revenue</th>
                  <th className="px-3 py-2 font-semibold">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {extended.geography.map((g) => {
                  const totalUsers = extended.geography.reduce(
                    (s, r) => s + r.users,
                    0,
                  );
                  const share = totalUsers
                    ? ((g.users / totalUsers) * 100).toFixed(1)
                    : "0";
                  return (
                    <tr key={g.region}>
                      <td className="px-3 py-3 font-medium">{g.region}</td>
                      <td className="px-3 py-3">{g.users.toLocaleString()}</td>
                      <td className="px-3 py-3">
                        ${g.revenue.toLocaleString()}
                      </td>
                      <td className="px-3 py-3">{share}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
