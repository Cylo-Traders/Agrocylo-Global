"use client";

import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Input,
  Text,
} from "@/components/ui";
import { WalletContext } from "@/context/WalletContext";
import { useSocket } from "@/hooks/useSocket";
import HealthStatus from "@/components/admin/HealthStatus";

interface PlatformConfig {
  feeBps: number;
  minStake: string;
  supportedTokens: string[];
  featureFlags: Record<string, boolean>;
  maintenanceMode: boolean;
}

const DEFAULT_CONFIG: PlatformConfig = {
  feeBps: 250,
  minStake: "100",
  supportedTokens: ["XLM", "USDC"],
  featureFlags: {
    enableBarter: true,
    enableEscrowV2: true,
    enableDemandSignals: false,
  },
  maintenanceMode: false,
};

const CONFIG_KEY = "admin:platform:config";

function loadConfig(): PlatformConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

interface ActivityEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail?: string;
}

const ACTIVITY_KEY = "admin:platform:activity";

function loadActivity(): ActivityEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function appendActivity(entry: ActivityEntry) {
  const current = loadActivity();
  const next = [entry, ...current].slice(0, 50);
  window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next));
  return next;
}

export default function AdminDashboardPage() {
  const { address, connected } = useContext(WalletContext);
  const { on: onSocket, isConnected: wsConnected } = useSocket();
  const [config, setConfig] = useState<PlatformConfig>(() => loadConfig());
  const [activity, setActivity] = useState<ActivityEntry[]>(() => loadActivity());
  const [openDisputes, setOpenDisputes] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState("");

  useEffect(() => {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }, [config]);

  const fetchDisputeCount = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/disputes");
      if (!res.ok) return;
      const data = await res.json();
      const count = (data.disputes ?? []).filter((d: any) => d.status?.toUpperCase() === "OPEN").length;
      setOpenDisputes(count);
    } catch {
      setOpenDisputes(null);
    }
  }, []);

  useEffect(() => {
    void fetchDisputeCount();
  }, [fetchDisputeCount]);

  useEffect(() => {
    const cleanup = onSocket("order:status_changed", () => void fetchDisputeCount());
    return cleanup;
  }, [onSocket, fetchDisputeCount]);

  const logAction = useCallback(
    (action: string, detail?: string) => {
      const entry: ActivityEntry = {
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: address ?? "unknown-admin",
        action,
        detail,
      };
      setActivity(appendActivity(entry));
    },
    [address]
  );

  const updateConfig = useCallback(
    (patch: Partial<PlatformConfig>, label: string) => {
      setConfig((prev) => ({ ...prev, ...patch }));
      logAction(label, JSON.stringify(patch));
    },
    [logAction]
  );

  const toggleFeature = (flag: string) => {
    const next = !config.featureFlags[flag];
    updateConfig(
      { featureFlags: { ...config.featureFlags, [flag]: next } },
      `feature_flag:${flag}=${next}`
    );
  };

  const addToken = () => {
    const t = tokenInput.trim().toUpperCase();
    if (!t || config.supportedTokens.includes(t)) return;
    updateConfig({ supportedTokens: [...config.supportedTokens, t] }, `token_added:${t}`);
    setTokenInput("");
  };

  const removeToken = (t: string) => {
    updateConfig(
      { supportedTokens: config.supportedTokens.filter((x) => x !== t) },
      `token_removed:${t}`
    );
  };

  const adminLinks = useMemo(
    () => [
      { href: "/admin/disputes", label: "Dispute Center", description: "Manage active escrow disputes" },
      { href: "/admin/users", label: "Users", description: "Account & permission management" },
      { href: "/admin/analytics", label: "Analytics", description: "Platform performance metrics" },
    ],
    []
  );

  if (!connected) {
    return (
      <Container size="lg" className="py-8">
        <Card variant="elevated" padding="lg">
          <CardContent className="text-center py-12">
            <Text variant="h3" as="h3" className="mb-4">Admin Access Required</Text>
            <Text variant="body" muted>Connect your admin wallet to view the dashboard.</Text>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="lg" className="py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Text variant="h2" as="h2" className="font-bold">Admin Dashboard</Text>
          <Text variant="body" muted>System monitoring and platform controls</Text>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={wsConnected ? "success" : "warning"}>
            {wsConnected ? "Live" : "Reconnecting…"}
          </Badge>
          {config.maintenanceMode && <Badge variant="error">Maintenance Mode</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {adminLinks.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card variant="elevated" padding="md" className="hover:shadow-lg transition cursor-pointer">
              <CardContent>
                <Text variant="bodySmall" className="font-semibold mb-1">{link.label}</Text>
                <Text variant="caption" muted>{link.description}</Text>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card variant="filled" padding="sm">
          <Text variant="caption" muted>Open Disputes</Text>
          <Text variant="h3" className="font-bold">{openDisputes ?? "—"}</Text>
        </Card>
        <Card variant="filled" padding="sm">
          <Text variant="caption" muted>Fee (bps)</Text>
          <Text variant="h3" className="font-bold">{config.feeBps}</Text>
        </Card>
        <Card variant="filled" padding="sm">
          <Text variant="caption" muted>Min Stake</Text>
          <Text variant="h3" className="font-bold">{config.minStake}</Text>
        </Card>
        <Card variant="filled" padding="sm">
          <Text variant="caption" muted>Supported Tokens</Text>
          <Text variant="h3" className="font-bold">{config.supportedTokens.length}</Text>
        </Card>
      </div>

      <HealthStatus />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card variant="elevated" padding="md">
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Input
                label="Platform Fee (basis points)"
                type="number"
                value={config.feeBps}
                onChange={(e) =>
                  updateConfig({ feeBps: Number(e.target.value) }, `fee_bps=${e.target.value}`)
                }
              />
              <Input
                label="Minimum Stake"
                value={config.minStake}
                onChange={(e) =>
                  updateConfig({ minStake: e.target.value }, `min_stake=${e.target.value}`)
                }
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Supported Tokens</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {config.supportedTokens.map((t) => (
                    <Badge key={t} variant="primary" className="cursor-pointer" onClick={() => removeToken(t)}>
                      {t} ✕
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add token symbol"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                  <Button variant="primary" onClick={addToken}>Add</Button>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Feature Flags</label>
                <div className="space-y-2">
                  {Object.entries(config.featureFlags).map(([flag, enabled]) => (
                    <label key={flag} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <Text variant="bodySmall">{flag}</Text>
                      <input type="checkbox" checked={enabled} onChange={() => toggleFeature(flag)} />
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <Text variant="bodySmall" className="font-medium">Maintenance Mode</Text>
                  <Text variant="caption" muted>Disable user-facing operations</Text>
                </div>
                <input
                  type="checkbox"
                  checked={config.maintenanceMode}
                  onChange={(e) =>
                    updateConfig({ maintenanceMode: e.target.checked }, `maintenance_mode=${e.target.checked}`)
                  }
                />
              </label>
            </div>
          </CardContent>
        </Card>

        <Card variant="elevated" padding="md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Admin Activity Log</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  window.localStorage.removeItem(ACTIVITY_KEY);
                  setActivity([]);
                }}
              >
                Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <Text variant="body" muted className="text-center py-6">No admin actions logged yet.</Text>
            ) : (
              <ul className="divide-y divide-border max-h-80 overflow-y-auto">
                {activity.map((entry) => (
                  <li key={entry.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Text variant="bodySmall" className="font-medium">{entry.action}</Text>
                      <Text variant="caption" muted>{new Date(entry.timestamp).toLocaleString()}</Text>
                    </div>
                    {entry.detail && (
                      <Text variant="caption" muted className="font-mono break-all">{entry.detail}</Text>
                    )}
                    <Text variant="caption" muted className="font-mono">{entry.actor.slice(0, 12)}…</Text>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
