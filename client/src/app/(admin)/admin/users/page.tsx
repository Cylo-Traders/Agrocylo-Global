"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  AlertCircle,
  Ban,
  MoreHorizontal,
  UserCheck,
  UserX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import {
  fetchAdminAuditLog,
  fetchAdminUsers,
  updateUserRole,
  updateUserStatus,
  type AdminAuditEntry,
  type AdminUser,
  type UserRole,
  type UserStatus,
} from "@/services/adminService";

const ROLES: UserRole[] = ["farmer", "buyer", "moderator", "admin"];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [usersData, auditData] = await Promise.all([
        fetchAdminUsers(),
        fetchAdminAuditLog(),
      ]);
      setUsers(usersData);
      setAudit(auditData.filter((e) => e.action.startsWith("user.")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleStatusChange = useCallback(
    async (wallet: string, status: UserStatus) => {
      setUsers((prev) =>
        prev.map((u) => (u.wallet === wallet ? { ...u, status } : u)),
      );
      await updateUserStatus(wallet, status);
      const fresh = await fetchAdminAuditLog();
      setAudit(fresh.filter((e) => e.action.startsWith("user.")));
    },
    [],
  );

  const handleRoleChange = useCallback(
    async (wallet: string, role: UserRole) => {
      setUsers((prev) =>
        prev.map((u) =>
          u.wallet === wallet
            ? { ...u, role: role as AdminUser["role"] }
            : u,
        ),
      );
      await updateUserRole(wallet, role);
      const fresh = await fetchAdminAuditLog();
      setAudit(fresh.filter((e) => e.action.startsWith("user.")));
    },
    [],
  );

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      {
        id: "user",
        header: "User",
        accessorFn: (row) =>
          `${row.displayName} ${row.wallet} ${row.country}`,
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex flex-col">
              <span className="text-sm font-medium">{u.displayName}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {u.wallet.slice(0, 6)}…{u.wallet.slice(-4)}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "role",
        header: "Role",
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const u = row.original;
          return (
            <Select
              value={u.role}
              onValueChange={(v) =>
                void handleRoleChange(u.wallet, v as UserRole)
              }
            >
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      },
      {
        accessorKey: "country",
        header: "Country",
        enableGlobalFilter: false,
      },
      {
        accessorKey: "orders",
        header: "Orders",
        enableGlobalFilter: false,
      },
      {
        accessorKey: "joined",
        header: "Joined",
        enableGlobalFilter: false,
      },
      {
        accessorKey: "status",
        header: "Status",
        enableGlobalFilter: false,
        cell: ({ getValue }) => {
          const status = String(getValue());
          const variant =
            status === "active"
              ? "success"
              : status === "banned"
                ? "destructive"
                : "secondary";
          return <Badge variant={variant}>{status}</Badge>;
        },
      },
      {
        id: "actions",
        header: "",
        enableGlobalFilter: false,
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original;
          const isActive = u.status === "active";
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>View profile</DropdownMenuItem>
                <DropdownMenuSeparator />
                {isActive ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() =>
                      void handleStatusChange(u.wallet, "suspended")
                    }
                  >
                    <UserX className="size-3.5" />
                    Suspend
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() =>
                      void handleStatusChange(u.wallet, "active")
                    }
                  >
                    <UserCheck className="size-3.5" />
                    Reinstate
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => void handleStatusChange(u.wallet, "banned")}
                >
                  <Ban className="size-3.5" />
                  Ban
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [handleRoleChange, handleStatusChange],
  );

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      return true;
    });
  }, [users, statusFilter, roleFilter]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users"
        description="Manage accounts, roles, and moderation across the platform."
      />

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

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
        <Select
          value={roleFilter}
          onValueChange={(v) => setRoleFilter(v as UserRole | "all")}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r} className="capitalize">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as UserStatus | "all")}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="banned">Banned</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          Showing {filteredUsers.length} of {users.length}
        </span>
      </div>

      {isLoading ? (
        <div className="bg-secondary/50 rounded-2xl border h-96 animate-pulse" />
      ) : filteredUsers.length === 0 ? (
        <div className="bg-card rounded-2xl border p-10 text-center">
          <h3 className="text-lg font-semibold">No users to show</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Adjust your filters or wait for users to register.
          </p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredUsers}
          searchPlaceholder="Search by name, wallet, or country…"
        />
      )}

      <div className="rounded-2xl border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">User Activity Log</h2>
          <span className="text-xs text-muted-foreground">
            {audit.length} entries
          </span>
        </div>
        <Separator className="my-4" />
        {audit.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No user actions logged yet.
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {audit.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{entry.action}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {entry.target
                      ? `${entry.target.slice(0, 8)}…${entry.target.slice(-4)}`
                      : "—"}
                    {entry.detail ? ` · ${entry.detail}` : ""}
                  </p>
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
  );
}
