"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  DollarSign,
  Package,
  Settings,
  Shield,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { HealthStatus } from "@/components/admin/HealthStatus";
import {
  fetchAdminAuditLog,
  fetchPlatformConfig,
  fetchPlatformStats,
  fetchRecentActivity,
  recordAdminAction,
  savePlatformConfig,
  type AdminAuditEntry,
  type PlatformConfig,
  type PlatformStats,
  type RecentActivity,
} from "@/services/adminService";

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [activity, setActivity] = useState<RecentActivity[]>([]);
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [tokenInput, setTokenInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [statsData, activityData, configData, auditData] =
        await Promise.all([
          fetchPlatformStats(),
          fetchRecentActivity(),
          fetchPlatformConfig(),
          fetchAdminAuditLog(),
        ]);
      setStats(statsData);
      setActivity(activityData);
      setConfig(configData);
      setAudit(auditData);
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

  const persistConfig = useCallback(
    async (next: PlatformConfig, action: string, detail?: string) => {
      setConfig(next);
      setSavingConfig(true);
      try {
        await savePlatformConfig(next);
        await recordAdminAction(action, undefined, detail);
        const fresh = await fetchAdminAuditLog();
        setAudit(fresh);
      } finally {
        setSavingConfig(false);
      }
    },
    [],
  );

  const updateConfigField = <K extends keyof PlatformConfig>(
    key: K,
    value: PlatformConfig[K],
    action: string,
  ) => {
    if (!config) return;
    void persistConfig({ ...config, [key]: value }, action, String(value));
  };

  const addToken = () => {
    if (!config) return;
    const t = tokenInput.trim().toUpperCase();
    if (!t || config.supportedTokens.includes(t)) return;
    void persistConfig(
      { ...config, supportedTokens: [...config.supportedTokens, t] },
      "config.token_added",
      t,
    );
    setTokenInput("");
  };

  const removeToken = (t: string) => {
    if (!config) return;
    void persistConfig(
      {
        ...config,
        supportedTokens: config.supportedTokens.filter((x) => x !== t),
      },
      "config.token_removed",
      t,
    );
  };

  const toggleFlag = (flag: string) => {
    if (!config) return;
    const next = !config.featureFlags[flag];
    void persistConfig(
      {
        ...config,
        featureFlags: { ...config.featureFlags, [flag]: next },
      },
      `config.flag:${flag}`,
      String(next),
    );
  };

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
      >
        {config?.maintenanceMode && (
          <Badge variant="destructive">Maintenance Mode</Badge>
        )}
      </PageHeader>

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

      <HealthStatus />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="text-primary size-4" />
              <h2 className="font-semibold">Configuration</h2>
            </div>
            {savingConfig && (
              <span className="text-muted-foreground text-xs">Saving…</span>
            )}
          </div>
          <Separator className="my-4" />
          {config ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fee-bps">Platform Fee (bps)</Label>
                  <Input
                    id="fee-bps"
                    type="number"
                    value={config.feeBps}
                    onChange={(e) =>
                      updateConfigField(
                        "feeBps",
                        Number(e.target.value),
                        "config.fee_bps",
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="min-stake">Minimum Stake</Label>
                  <Input
                    id="min-stake"
                    value={config.minStake}
                    onChange={(e) =>
                      updateConfigField(
                        "minStake",
                        e.target.value,
                        "config.min_stake",
                      )
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Supported Tokens</Label>
                <div className="flex flex-wrap gap-2">
                  {config.supportedTokens.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => removeToken(t)}
                      className="bg-primary/10 text-primary hover:bg-primary/20 rounded-full px-3 py-1 text-xs font-medium transition-colors"
                      title="Click to remove"
                    >
                      {t} ✕
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add token (e.g. EURC)"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addToken();
                      }
                    }}
                  />
                  <Button variant="outline" size="sm" onClick={addToken}>
                    Add
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Feature Flags</Label>
                <div className="space-y-2">
                  {Object.entries(config.featureFlags).map(
                    ([flag, enabled]) => (
                      <div
                        key={flag}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                      >
                        <span className="text-sm">{flag}</span>
                        <Switch
                          checked={enabled}
                          onCheckedChange={() => toggleFlag(flag)}
                        />
                      </div>
                    ),
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
                <div>
                  <p className="text-sm font-medium">Maintenance Mode</p>
                  <p className="text-muted-foreground text-xs">
                    Disable user-facing actions across the platform.
                  </p>
                </div>
                <Switch
                  checked={config.maintenanceMode}
                  onCheckedChange={(checked: boolean) =>
                    updateConfigField(
                      "maintenanceMode",
                      checked,
                      "config.maintenance_mode",
                    )
                  }
                />
              </div>
            </div>
          ) : (
            <div className="bg-secondary/50 rounded-lg h-64 animate-pulse" />
          )}
        </div>

        <div className="rounded-2xl border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Admin Audit Log</h2>
            <span className="text-muted-foreground text-xs">
              {audit.length} entries
            </span>
          </div>
          <Separator className="my-4" />
          {audit.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-3 py-12 text-sm">
              <Activity className="size-8" />
              <p>No admin actions yet.</p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {audit.slice(0, 25).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{entry.action}</p>
                    {(entry.target || entry.detail) && (
                      <p className="text-muted-foreground font-mono text-xs">
                        {entry.target ?? ""}
                        {entry.target && entry.detail ? " · " : ""}
                        {entry.detail ?? ""}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

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

        <div className="rounded-2xl border bg-card">
          <div className="flex items-center justify-between p-6">
            <h2 className="font-semibold">Status Reference</h2>
            <span className="text-muted-foreground text-xs">Visual key</span>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-5">
            <StatusBadge status="Pending" />
            <StatusBadge status="Delivered" />
            <StatusBadge status="Completed" />
            <StatusBadge status="Refunded" />
            <StatusBadge status="Disputed" />
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
