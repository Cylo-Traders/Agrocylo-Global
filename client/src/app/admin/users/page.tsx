"use client";

import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
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

type UserStatus = "active" | "suspended" | "banned" | "pending";
type UserRole = "buyer" | "farmer" | "admin" | "moderator";

interface AdminUser {
  id: string;
  address: string;
  displayName?: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastActiveAt?: string;
  totalOrders?: number;
  flagged?: boolean;
}

interface ActivityEvent {
  id: string;
  timestamp: string;
  userId: string;
  action: string;
  by: string;
}

const STATUS_VARIANT: Record<UserStatus, "success" | "warning" | "error" | "default"> = {
  active: "success",
  pending: "warning",
  suspended: "warning",
  banned: "error",
};

const ROLE_OPTIONS: UserRole[] = ["buyer", "farmer", "moderator", "admin"];

const ACTIVITY_KEY = "admin:users:activity";

function loadActivity(): ActivityEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistActivity(events: ActivityEvent[]) {
  window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(events.slice(0, 200)));
}

async function fetchUsers(): Promise<AdminUser[]> {
  try {
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      return data.users ?? [];
    }
  } catch {
    // fall through to demo data
  }
  return [
    {
      id: "u-1001",
      address: "GABCD1234EFGH5678IJKL9012MNOP3456QRST7890UVWX",
      displayName: "Adaeze Okonkwo",
      role: "farmer",
      status: "active",
      createdAt: "2025-02-12T09:21:00Z",
      lastActiveAt: "2026-05-28T14:02:00Z",
      totalOrders: 38,
    },
    {
      id: "u-1002",
      address: "GZYXW9876VUTS5432RQPO1098NMLK6543JIHG2109FEDC",
      displayName: "Ibrahim Sadiq",
      role: "buyer",
      status: "active",
      createdAt: "2025-08-04T11:00:00Z",
      lastActiveAt: "2026-05-29T08:11:00Z",
      totalOrders: 12,
    },
    {
      id: "u-1003",
      address: "GMNOP1111QRST2222UVWX3333ABCD4444EFGH5555IJKL",
      role: "buyer",
      status: "suspended",
      createdAt: "2024-11-20T16:45:00Z",
      lastActiveAt: "2026-04-30T19:50:00Z",
      totalOrders: 2,
      flagged: true,
    },
    {
      id: "u-1004",
      address: "GHIJK6666LMNO7777PQRS8888TUVW9999XYZA0000BCDE",
      displayName: "Moderator Alice",
      role: "moderator",
      status: "active",
      createdAt: "2024-05-10T08:30:00Z",
      lastActiveAt: "2026-05-29T07:00:00Z",
      totalOrders: 0,
    },
  ];
}

export default function AdminUsersPage() {
  const { address, connected } = useContext(WalletContext);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [activity, setActivity] = useState<ActivityEvent[]>(() => loadActivity());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await fetchUsers());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logEvent = useCallback(
    (userId: string, action: string) => {
      const event: ActivityEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        userId,
        action,
        by: address ?? "unknown-admin",
      };
      const next = [event, ...activity].slice(0, 200);
      setActivity(next);
      persistActivity(next);
    },
    [activity, address]
  );

  const updateUser = useCallback(
    (id: string, patch: Partial<AdminUser>, action: string) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
      logEvent(id, action);
    },
    [logEvent]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (!q) return true;
      return [u.address, u.displayName ?? "", u.id].join(" ").toLowerCase().includes(q);
    });
  }, [users, search, roleFilter, statusFilter]);

  if (!connected) {
    return (
      <Container size="lg" className="py-8">
        <Card variant="elevated" padding="lg">
          <CardContent className="text-center py-12">
            <Text variant="h3" as="h3" className="mb-4">Admin Access Required</Text>
            <Text variant="body" muted>Connect your admin wallet to manage users.</Text>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="lg" className="py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Text variant="h2" as="h2" className="font-bold">User Management</Text>
          <Text variant="body" muted>Accounts, roles, and moderation</Text>
        </div>
        <Button variant="outline" onClick={() => void refresh()} isLoading={loading}>Refresh</Button>
      </div>

      <Card variant="elevated" padding="md">
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              placeholder="Search address, name, or ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as UserRole | "all")}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="all">All Roles</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as UserStatus | "all")}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
              <option value="banned">Banned</option>
            </select>
            <div className="flex items-center justify-end">
              <Text variant="caption" muted>{filtered.length} of {users.length}</Text>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card variant="elevated" padding="md">
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 px-3 text-xs uppercase text-muted">User</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted">Role</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted">Status</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted">Orders</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted">Last Active</th>
                  <th className="py-3 px-3 text-xs uppercase text-muted text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-3">
                      <Text variant="bodySmall" className="font-semibold">
                        {u.displayName ?? "—"}
                        {u.flagged && <Badge variant="error" className="ml-2">flagged</Badge>}
                      </Text>
                      <Text variant="caption" muted className="font-mono break-all">
                        {u.address.slice(0, 8)}…{u.address.slice(-6)}
                      </Text>
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={u.role}
                        onChange={(e) =>
                          updateUser(u.id, { role: e.target.value as UserRole }, `role_changed:${e.target.value}`)
                        }
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-3">
                      <Badge variant={STATUS_VARIANT[u.status]}>{u.status}</Badge>
                    </td>
                    <td className="py-3 px-3 text-sm">{u.totalOrders ?? 0}</td>
                    <td className="py-3 px-3 text-sm">
                      {u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 px-3 text-right space-x-1">
                      {u.status === "active" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => updateUser(u.id, { status: "suspended" }, "suspended")}
                        >
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => updateUser(u.id, { status: "active" }, "reinstated")}
                        >
                          Reinstate
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => updateUser(u.id, { status: "banned" }, "banned")}
                      >
                        Ban
                      </Button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center">
                      <Text variant="body" muted>No users match your filters.</Text>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card variant="elevated" padding="md">
        <CardHeader>
          <CardTitle className="text-base">Recent User Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <Text variant="body" muted className="text-center py-6">No admin user actions yet.</Text>
          ) : (
            <ul className="divide-y divide-border max-h-72 overflow-y-auto">
              {activity.map((event) => (
                <li key={event.id} className="py-2 flex items-center justify-between gap-3">
                  <div>
                    <Text variant="bodySmall" className="font-medium">{event.action}</Text>
                    <Text variant="caption" muted className="font-mono">
                      user: {event.userId} · by: {event.by.slice(0, 12)}…
                    </Text>
                  </div>
                  <Text variant="caption" muted>{new Date(event.timestamp).toLocaleString()}</Text>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
