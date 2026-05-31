"use client";

import { useState, useEffect, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, UserCheck, UserX, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { fetchAdminUsers, type AdminUser } from "@/services/adminService";

const columns: ColumnDef<AdminUser>[] = [
  {
    id: "user",
    header: "User",
    accessorFn: (row) => `${row.displayName} ${row.wallet} ${row.country}`,
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
    cell: ({ getValue }) => (
      <Badge variant="secondary" className="capitalize">
        {String(getValue())}
      </Badge>
    ),
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
      return (
        <Badge variant={status === "active" ? "success" : "destructive"}>
          {status}
        </Badge>
      );
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
            <Button variant="ghost" size="icon" className="size-11">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled>View profile</DropdownMenuItem>
            <DropdownMenuSeparator />
            {isActive ? (
              <DropdownMenuItem className="text-destructive focus:text-destructive">
                <UserX className="size-3.5" />
                Suspend
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem>
                <UserCheck className="size-3.5" />
                Reinstate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const usersData = await fetchAdminUsers();
      setUsers(usersData);
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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users"
        description="Every farmer and buyer registered on the platform."
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

      {isLoading ? (
        <div className="bg-secondary/50 rounded-2xl border h-96 animate-pulse" />
      ) : users.length === 0 ? (
        <div className="bg-card rounded-2xl border p-10 text-center">
          <h3 className="text-lg font-semibold">No users to show yet</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            No users have registered on the platform.
          </p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={users}
          searchPlaceholder="Search by name, wallet, or country…"
        />
      )}
    </div>
  );
}
