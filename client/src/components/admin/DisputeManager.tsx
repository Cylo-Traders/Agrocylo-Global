"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gavel,
  Image as ImageIcon,
  Settings2,
} from "lucide-react";
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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  bulkDisputeAction,
  reviewAppeal,
  type DisputeBulkAction,
} from "@/services/adminService";
import DisputeActionModal from "./DisputeActionModal";

interface Dispute {
  id?: string;
  orderIdOnChain?: string;
  raisedBy?: string;
  reason?: string;
  status?: string;
  evidenceHash?: string;
  evidenceUrls?: string[];
  order?: { amount?: string; orderIdOnChain?: string };
  createdAt?: string;
  resolvedAt?: string;
  appealCount?: number;
  [k: string]: unknown;
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

const TEMPLATES_KEY = "admin:dispute-resolution-templates";

function loadTemplates(): ResolutionTemplate[] {
  if (typeof window === "undefined") return DEFAULT_TEMPLATES;
  try {
    const raw = window.localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return DEFAULT_TEMPLATES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : DEFAULT_TEMPLATES;
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

function statusVariant(
  status?: string,
): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" {
  switch ((status ?? "").toUpperCase()) {
    case "OPEN":
      return "warning";
    case "RESOLVED":
      return "success";
    case "REJECTED":
      return "destructive";
    case "APPEALED":
      return "secondary";
    case "UNDER_REVIEW":
      return "outline";
    default:
      return "outline";
  }
}

function isImageUrl(url: string) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(url);
}

function ipfsToHttp(hash: string) {
  return `https://ipfs.io/ipfs/${hash}`;
}

const PIE_COLORS = ["#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#94a3b8"];

interface DisputeManagerProps {
  disputes: Dispute[];
  onRefresh: () => void;
}

export default function DisputeManager({
  disputes,
  onRefresh,
}: DisputeManagerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [activeDispute, setActiveDispute] = useState<Dispute | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<Dispute | null>(null);
  const [appealFor, setAppealFor] = useState<Dispute | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<ResolutionTemplate[]>(() =>
    loadTemplates(),
  );
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }, [templates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return disputes.filter((d) => {
      const matchesStatus =
        statusFilter === "all" ||
        (d.status ?? "").toUpperCase() === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      const orderId = d.orderIdOnChain ?? d.order?.orderIdOnChain ?? "";
      return [orderId, d.raisedBy ?? "", d.reason ?? ""]
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
    const resolved = disputes.filter(
      (d) => (d.status ?? "").toUpperCase() === "RESOLVED",
    );
    const avgResolutionHours = resolved.length
      ? resolved.reduce((sum, d) => {
          if (!d.createdAt || !d.resolvedAt) return sum;
          return (
            sum +
            (new Date(d.resolvedAt).getTime() -
              new Date(d.createdAt).getTime()) /
              3_600_000
          );
        }, 0) / resolved.length
      : 0;
    const appealRate = disputes.length
      ? (disputes.filter((d) => (d.appealCount ?? 0) > 0).length /
          disputes.length) *
        100
      : 0;
    return {
      total: disputes.length,
      open: byStatus["OPEN"] ?? 0,
      resolved: byStatus["RESOLVED"] ?? 0,
      rejected: byStatus["REJECTED"] ?? 0,
      appealed: byStatus["APPEALED"] ?? 0,
      avgResolutionHours,
      appealRate,
      pieData: Object.entries(byStatus).map(([name, value]) => ({
        name,
        value,
      })),
      timeSeries: Object.entries(byDay)
        .sort(
          ([a], [b]) => new Date(a).getTime() - new Date(b).getTime(),
        )
        .map(([day, count]) => ({ day, count })),
    };
  }, [disputes]);

  const openIds = useMemo(
    () =>
      filtered
        .filter((d) => (d.status ?? "").toUpperCase() === "OPEN")
        .map((d) => d.id)
        .filter((id): id is string => Boolean(id)),
    [filtered],
  );

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(openIds) : new Set());
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const runBulk = useCallback(
    async (action: DisputeBulkAction) => {
      if (selectedIds.size === 0) return;
      setBulkBusy(true);
      try {
        await bulkDisputeAction(Array.from(selectedIds), action);
        setSelectedIds(new Set());
        onRefresh();
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, onRefresh],
  );

  return (
    <div className="space-y-6">
      {/* Analytics summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryTile label="Total" value={analytics.total} />
        <SummaryTile label="Open" value={analytics.open} tone="warning" />
        <SummaryTile
          label="Resolved"
          value={analytics.resolved}
          tone="success"
        />
        <SummaryTile
          label="Avg Resolution"
          value={`${analytics.avgResolutionHours.toFixed(1)}h`}
        />
        <SummaryTile
          label="Appeal Rate"
          value={`${analytics.appealRate.toFixed(1)}%`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border bg-card p-6 lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold">Disputes per Day</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={analytics.timeSeries}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <Tooltip />
              <Bar
                dataKey="count"
                fill="var(--color-primary)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold">Status Breakdown</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={analytics.pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={2}
              >
                {analytics.pieData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={PIE_COLORS[i % PIE_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Toolbar */}
      <div className="rounded-2xl border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Search order, address, reason…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="APPEALED">Appealed</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under review</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTemplates(true)}
          >
            <ClipboardList className="size-3.5" />
            Templates ({templates.length})
          </Button>
        </div>

        {selectedIds.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-3">
            <span className="text-sm font-medium">
              {selectedIds.size} selected
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="default"
              disabled={bulkBusy}
              onClick={() => void runBulk("resolve-refund")}
            >
              Bulk refund
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => void runBulk("resolve-release")}
            >
              Bulk release
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkBusy}
              onClick={() => void runBulk("reject")}
            >
              Bulk reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground text-xs uppercase">
              <tr className="border-b">
                <th className="px-3 py-2 w-8">
                  <Checkbox
                    checked={
                      openIds.length > 0 &&
                      selectedIds.size === openIds.length
                    }
                    onCheckedChange={(c) => toggleAll(Boolean(c))}
                    aria-label="Select all open"
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">Raised by</th>
                <th className="px-3 py-2 font-semibold">Reason</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Appeals</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((d, i) => {
                const id = d.id ?? `row-${i}`;
                const orderId =
                  d.orderIdOnChain ?? d.order?.orderIdOnChain ?? "—";
                const status = (d.status ?? "").toUpperCase();
                const isOpen = status === "OPEN";
                const isAppealed = status === "APPEALED";
                const hasEvidence =
                  Boolean(d.evidenceHash) ||
                  (d.evidenceUrls?.length ?? 0) > 0;
                return (
                  <tr
                    key={id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={selectedIds.has(id)}
                        disabled={!isOpen || !d.id}
                        onCheckedChange={() => d.id && toggleOne(d.id)}
                        aria-label={`Select dispute ${id}`}
                      />
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      #{orderId}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {d.raisedBy
                        ? `${d.raisedBy.slice(0, 6)}…${d.raisedBy.slice(-4)}`
                        : "—"}
                    </td>
                    <td className="max-w-xs truncate px-3 py-3">
                      {d.reason ?? (
                        <span className="text-muted-foreground italic">
                          No reason
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={statusVariant(d.status)}>
                        {d.status ?? "UNKNOWN"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-sm">
                      {d.appealCount ?? 0}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {hasEvidence && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEvidenceFor(d)}
                          >
                            <FileText className="size-3.5" />
                            Evidence
                          </Button>
                        )}
                        {isAppealed && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAppealFor(d)}
                          >
                            <Gavel className="size-3.5" />
                            Review appeal
                          </Button>
                        )}
                        {isOpen && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setActiveDispute(d)}
                          >
                            <Settings2 className="size-3.5" />
                            Manage
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-muted-foreground py-12 text-center"
                  >
                    No disputes match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && <Separator className="mt-2" />}
      </div>

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

      {evidenceFor && (
        <EvidenceViewer
          dispute={evidenceFor}
          onClose={() => setEvidenceFor(null)}
        />
      )}

      {appealFor && (
        <AppealReviewDialog
          dispute={appealFor}
          onClose={() => setAppealFor(null)}
          onResolved={() => {
            setAppealFor(null);
            onRefresh();
          }}
        />
      )}

      {showTemplates && (
        <TemplatesDialog
          templates={templates}
          onChange={setTemplates}
          onClose={() => setShowTemplates(false)}
        />
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warning" | "success";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-bold " +
          (tone === "warning"
            ? "text-amber-600"
            : tone === "success"
              ? "text-emerald-600"
              : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

function EvidenceViewer({
  dispute,
  onClose,
}: {
  dispute: Dispute;
  onClose: () => void;
}) {
  const items = useMemo(() => {
    const urls = dispute.evidenceUrls ?? [];
    if (dispute.evidenceHash && urls.length === 0) {
      return [ipfsToHttp(dispute.evidenceHash)];
    }
    return urls;
  }, [dispute]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Evidence</DialogTitle>
          <DialogDescription>
            Files and documents submitted with this dispute.
          </DialogDescription>
        </DialogHeader>
        {items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No evidence attached.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {items.map((url, idx) => (
              <div
                key={idx}
                className="overflow-hidden rounded-xl border border-border"
              >
                {isImageUrl(url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={`Evidence ${idx + 1}`}
                    className="h-44 w-full object-cover"
                  />
                ) : (
                  <div className="bg-muted/30 flex h-44 flex-col items-center justify-center gap-2">
                    <ImageIcon className="text-muted-foreground size-8" />
                    <span className="text-muted-foreground max-w-full truncate px-3 text-xs">
                      {url.split("/").pop()}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border p-3">
                  <span className="text-xs text-muted-foreground">
                    Item {idx + 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(url, "_blank")}
                  >
                    Open
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppealReviewDialog({
  dispute,
  onClose,
  onResolved,
}: {
  dispute: Dispute;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [decision, setDecision] = useState<"uphold" | "overturn">("uphold");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!dispute.id) return;
    setBusy(true);
    try {
      await reviewAppeal(dispute.id, decision, notes);
      onResolved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review Appeal</DialogTitle>
          <DialogDescription>
            Decide whether the previous resolution stands or is overturned.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-muted/40 p-3 text-sm">
            <p className="text-muted-foreground text-xs uppercase">
              Original reason
            </p>
            <p className="mt-1">
              {dispute.reason ?? "—"}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Decision</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={decision === "uphold" ? "default" : "outline"}
                onClick={() => setDecision("uphold")}
              >
                <CheckCircle2 className="size-3.5" />
                Uphold
              </Button>
              <Button
                size="sm"
                variant={decision === "overturn" ? "default" : "outline"}
                onClick={() => setDecision("overturn")}
              >
                <AlertTriangle className="size-3.5" />
                Overturn
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="appeal-notes">Notes (optional)</Label>
            <Textarea
              id="appeal-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reasoning for the appeal decision…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            Submit decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesDialog({
  templates,
  onChange,
  onClose,
}: {
  templates: ResolutionTemplate[];
  onChange: (next: ResolutionTemplate[]) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");

  const add = () => {
    if (!label.trim() || !body.trim()) return;
    onChange([
      ...templates,
      { id: `tpl-${Date.now()}`, label: label.trim(), body: body.trim() },
    ]);
    setLabel("");
    setBody("");
  };

  const remove = (id: string) =>
    onChange(templates.filter((t) => t.id !== id));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Resolution Templates</DialogTitle>
          <DialogDescription>
            Reusable text snippets for dispute outcomes. Stored locally.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-3 overflow-y-auto">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-border p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">{t.label}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(t.id)}
                >
                  Remove
                </Button>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">{t.body}</p>
            </div>
          ))}
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="tpl-label">New template label</Label>
            <Input
              id="tpl-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-body">Body</Label>
            <Textarea
              id="tpl-body"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <Button onClick={add}>Add template</Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
