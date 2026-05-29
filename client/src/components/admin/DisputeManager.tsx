"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Text,
} from "@/components/ui";
import { useSocket } from "@/hooks/useSocket";
import DisputeActionModal from "./DisputeActionModal";

type DisputeStatus = "OPEN" | "RESOLVED" | "REJECTED" | "APPEALED" | "UNDER_REVIEW";

interface Dispute {
  id: string;
  orderIdOnChain?: string;
  raisedBy: string;
  reason?: string;
  status: DisputeStatus | string;
  evidenceHash?: string;
  evidenceUrls?: string[];
  createdAt?: string;
  resolvedAt?: string;
  appealCount?: number;
  order?: { orderIdOnChain?: string; amount?: string };
}

interface ResolutionTemplate {
  id: string;
  label: string;
  body: string;
}

const DEFAULT_TEMPLATES: ResolutionTemplate[] = [
  {
    id: "tpl-refund",
    label: "Full Refund — Goods Not Delivered",
    body: "Funds released back to buyer due to confirmed non-delivery. Farmer notified.",
  },
  {
    id: "tpl-release",
    label: "Release to Farmer — Buyer Unresponsive",
    body: "Funds released to farmer after buyer failed to respond within the dispute window.",
  },
  {
    id: "tpl-split",
    label: "Split — Partial Damage",
    body: "Funds split per assessed damage report. See appended evidence.",
  },
  {
    id: "tpl-reject",
    label: "Dispute Rejected — Insufficient Evidence",
    body: "Insufficient evidence provided. Order proceeds under original terms.",
  },
];

const TEMPLATES_KEY = "admin:dispute:resolution-templates";

function loadTemplates(): ResolutionTemplate[] {
  if (typeof window === "undefined") return DEFAULT_TEMPLATES;
  try {
    const raw = window.localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return DEFAULT_TEMPLATES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_TEMPLATES;
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

function statusVariant(status: string): "success" | "warning" | "error" | "primary" | "default" {
  switch (status?.toUpperCase()) {
    case "OPEN":
      return "warning";
    case "RESOLVED":
      return "success";
    case "REJECTED":
      return "error";
    case "APPEALED":
      return "primary";
    case "UNDER_REVIEW":
      return "default";
    default:
      return "default";
  }
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(url);
}

function ipfsToHttp(hash: string): string {
  return `https://ipfs.io/ipfs/${hash}`;
}

interface EvidenceViewerProps {
  dispute: Dispute;
  onClose: () => void;
}

function EvidenceViewer({ dispute, onClose }: EvidenceViewerProps) {
  const items = useMemo(() => {
    const urls = dispute.evidenceUrls ?? [];
    if (dispute.evidenceHash && !urls.length) return [ipfsToHttp(dispute.evidenceHash)];
    return urls;
  }, [dispute]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card variant="elevated" className="w-full max-w-3xl max-h-[85vh] overflow-y-auto">
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-4">
            <Text variant="h3" className="font-bold">Evidence Viewer</Text>
            <Button variant="outline" size="sm" onClick={onClose}>×</Button>
          </div>
          {items.length === 0 ? (
            <Text variant="body" muted className="text-center py-8">No evidence attached.</Text>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {items.map((url, idx) => (
                <div key={idx} className="border border-border rounded-lg overflow-hidden">
                  {isImageUrl(url) ? (
                    <img src={url} alt={`Evidence ${idx + 1}`} className="w-full h-48 object-cover" />
                  ) : (
                    <div className="p-6 flex flex-col items-center justify-center h-48 bg-muted/20">
                      <Text variant="body" className="mb-2">Document</Text>
                      <Text variant="caption" muted className="break-all text-center">
                        {url.split("/").pop()}
                      </Text>
                    </div>
                  )}
                  <div className="p-3 border-t border-border flex items-center justify-between">
                    <Text variant="caption" muted>Item {idx + 1}</Text>
                    <Button variant="outline" size="sm" onClick={() => window.open(url, "_blank")}>
                      Open
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface TemplatesPanelProps {
  templates: ResolutionTemplate[];
  onChange: (templates: ResolutionTemplate[]) => void;
  onClose: () => void;
}

function TemplatesPanel({ templates, onChange, onClose }: TemplatesPanelProps) {
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");

  const addTemplate = () => {
    if (!label.trim() || !body.trim()) return;
    const next = [...templates, { id: `tpl-${Date.now()}`, label: label.trim(), body: body.trim() }];
    onChange(next);
    setLabel("");
    setBody("");
  };

  const removeTemplate = (id: string) => onChange(templates.filter((t) => t.id !== id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card variant="elevated" className="w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-4">
            <Text variant="h3" className="font-bold">Resolution Templates</Text>
            <Button variant="outline" size="sm" onClick={onClose}>×</Button>
          </div>
          <div className="space-y-3 mb-6">
            {templates.map((t) => (
              <div key={t.id} className="border border-border rounded-lg p-3">
                <div className="flex justify-between items-start mb-1">
                  <Text variant="bodySmall" className="font-semibold">{t.label}</Text>
                  <Button variant="ghost" size="sm" onClick={() => removeTemplate(t.id)}>Remove</Button>
                </div>
                <Text variant="caption" muted>{t.body}</Text>
              </div>
            ))}
          </div>
          <div className="space-y-3 border-t border-border pt-4">
            <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <Button variant="primary" onClick={addTemplate}>Add Template</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface DisputeManagerProps {
  disputes: Dispute[];
  onRefresh: () => void;
  onBulkAction?: (ids: string[], action: "resolve-refund" | "resolve-release" | "reject") => Promise<void> | void;
}

export default function DisputeManager({ disputes, onRefresh, onBulkAction }: DisputeManagerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [activeDispute, setActiveDispute] = useState<Dispute | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<Dispute | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<ResolutionTemplate[]>(() => loadTemplates());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { on: onSocket } = useSocket();

  useEffect(() => {
    window.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }, [templates]);

  useEffect(() => {
    const cleanup = onSocket("dispute:updated", () => onRefresh());
    return cleanup;
  }, [onSocket, onRefresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return disputes.filter((d) => {
      const matchesStatus = statusFilter === "all" || d.status?.toUpperCase() === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return [
        d.orderIdOnChain ?? d.order?.orderIdOnChain ?? "",
        d.raisedBy,
        d.reason ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [disputes, statusFilter, search]);

  const analytics = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const d of disputes) {
      const key = (d.status ?? "UNKNOWN").toUpperCase();
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    const byDay: Record<string, number> = {};
    for (const d of disputes) {
      if (!d.createdAt) continue;
      const day = new Date(d.createdAt).toLocaleDateString();
      byDay[day] = (byDay[day] ?? 0) + 1;
    }
    const resolved = disputes.filter((d) => d.status?.toUpperCase() === "RESOLVED");
    const avgResolutionHours = resolved.length
      ? resolved.reduce((sum, d) => {
          if (!d.createdAt || !d.resolvedAt) return sum;
          return sum + (new Date(d.resolvedAt).getTime() - new Date(d.createdAt).getTime()) / 3_600_000;
        }, 0) / resolved.length
      : 0;
    const appealRate = disputes.length
      ? (disputes.filter((d) => (d.appealCount ?? 0) > 0).length / disputes.length) * 100
      : 0;
    return {
      total: disputes.length,
      open: byStatus["OPEN"] ?? 0,
      resolved: byStatus["RESOLVED"] ?? 0,
      rejected: byStatus["REJECTED"] ?? 0,
      appealed: byStatus["APPEALED"] ?? 0,
      avgResolutionHours,
      appealRate,
      pieData: Object.entries(byStatus).map(([name, value]) => ({ name, value })),
      timeSeries: Object.entries(byDay)
        .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
        .map(([day, count]) => ({ day, count })),
    };
  }, [disputes]);

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(filtered.filter((d) => d.status?.toUpperCase() === "OPEN").map((d) => d.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const runBulk = useCallback(
    async (action: "resolve-refund" | "resolve-release" | "reject") => {
      if (!onBulkAction || selected.size === 0) return;
      setBulkBusy(true);
      try {
        await onBulkAction(Array.from(selected), action);
        setSelected(new Set());
        onRefresh();
      } finally {
        setBulkBusy(false);
      }
    },
    [onBulkAction, onRefresh, selected]
  );

  const PIE_COLORS = ["#f59e0b", "#10b981", "#ef4444", "#6366f1", "#94a3b8"];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card variant="filled" padding="sm">
          <Text variant="caption" muted>Total</Text>
          <Text variant="h3" className="font-bold">{analytics.total}</Text>
        </Card>
        <Card variant="filled" padding="sm">
          <Text variant="caption" muted>Open</Text>
          <Text variant="h3" className="font-bold">{analytics.open}</Text>
        </Card>
        <Card variant="filled" padding="sm">
          <Text variant="caption" muted>Resolved</Text>
          <Text variant="h3" className="font-bold">{analytics.resolved}</Text>
        </Card>
        <Card variant="filled" padding="sm">
          <Text variant="caption" muted>Avg Resolution</Text>
          <Text variant="h3" className="font-bold">{analytics.avgResolutionHours.toFixed(1)}h</Text>
        </Card>
        <Card variant="filled" padding="sm">
          <Text variant="caption" muted>Appeal Rate</Text>
          <Text variant="h3" className="font-bold">{analytics.appealRate.toFixed(1)}%</Text>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card variant="elevated" padding="md" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Disputes Per Day</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card variant="elevated" padding="md">
          <CardHeader>
            <CardTitle className="text-base">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={analytics.pieData} dataKey="value" nameKey="name" outerRadius={70} label>
                    {analytics.pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card variant="elevated" padding="md">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Disputes ({filtered.length})</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search order, address, reason"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="!min-h-9 !py-2 max-w-xs"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="all">All Statuses</option>
                <option value="OPEN">Open</option>
                <option value="RESOLVED">Resolved</option>
                <option value="REJECTED">Rejected</option>
                <option value="APPEALED">Appealed</option>
                <option value="UNDER_REVIEW">Under Review</option>
              </select>
              <Button variant="outline" size="sm" onClick={() => setShowTemplates(true)}>
                Templates
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selected.size > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-3">
              <Text variant="bodySmall" className="font-medium">
                {selected.size} selected
              </Text>
              <div className="flex-1" />
              <Button variant="primary" size="sm" onClick={() => runBulk("resolve-refund")} isLoading={bulkBusy}>
                Bulk Refund
              </Button>
              <Button variant="secondary" size="sm" onClick={() => runBulk("resolve-release")} isLoading={bulkBusy}>
                Bulk Release
              </Button>
              <Button variant="danger" size="sm" onClick={() => runBulk("reject")} isLoading={bulkBusy}>
                Bulk Reject
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === filtered.filter((d) => d.status?.toUpperCase() === "OPEN").length}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </th>
                  <th className="py-3 px-3 text-xs uppercase text-muted">Order</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted">Raised By</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted">Reason</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted">Status</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted">Appeals</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((d) => {
                  const isOpen = d.status?.toUpperCase() === "OPEN";
                  return (
                    <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-3">
                        <input
                          type="checkbox"
                          checked={selected.has(d.id)}
                          disabled={!isOpen}
                          onChange={() => toggleOne(d.id)}
                        />
                      </td>
                      <td className="py-3 px-3 font-mono text-xs">{d.orderIdOnChain ?? d.order?.orderIdOnChain}</td>
                      <td className="py-3 px-3 font-mono text-xs truncate max-w-[140px]">{d.raisedBy}</td>
                      <td className="py-3 px-3 text-sm truncate max-w-[220px]">{d.reason ?? "—"}</td>
                      <td className="py-3 px-3">
                        <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                      </td>
                      <td className="py-3 px-3 text-sm">{d.appealCount ?? 0}</td>
                      <td className="py-3 px-3 text-right space-x-1">
                        {(d.evidenceHash || (d.evidenceUrls?.length ?? 0) > 0) && (
                          <Button variant="ghost" size="sm" onClick={() => setEvidenceFor(d)}>
                            Evidence
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setActiveDispute(d)}
                          disabled={!isOpen && d.status?.toUpperCase() !== "APPEALED"}
                        >
                          {d.status?.toUpperCase() === "APPEALED" ? "Review Appeal" : "Manage"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center">
                      <Text variant="body" muted>No disputes match your filters.</Text>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {activeDispute && (
        <DisputeActionModal
          dispute={activeDispute}
          onClose={() => setActiveDispute(null)}
          onSuccess={() => {
            setActiveDispute(null);
            onRefresh();
          }}
        />
      )}
      {evidenceFor && <EvidenceViewer dispute={evidenceFor} onClose={() => setEvidenceFor(null)} />}
      {showTemplates && (
        <TemplatesPanel templates={templates} onChange={setTemplates} onClose={() => setShowTemplates(false)} />
      )}
    </div>
  );
}
