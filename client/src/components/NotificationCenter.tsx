"use client";

import { useState } from "react";
import { Bell, Search, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { useNotifications, type NotificationFilter } from "@/hooks/useNotifications";
import type { OrderEventNotification } from "@/services/notification/api";

const FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "orders", label: "Orders" },
  { id: "disputes", label: "Disputes" },
  { id: "system", label: "System" },
];

interface NotificationCenterProps {
  walletAddress: string | null;
  className?: string;
}

function NotificationItem({
  notification,
  onMarkRead,
  onDelete,
}: {
  notification: OrderEventNotification;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const date = new Date(notification.createdAt);

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 transition-colors",
        notification.isRead
          ? "border-transparent bg-secondary/30"
          : "border-primary/20 bg-background",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {notification.type}
          </Badge>
          {!notification.isRead && (
            <span className="bg-primary size-1.5 shrink-0 rounded-full" />
          )}
        </div>
        <p className="text-sm leading-relaxed">{notification.message}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {date.toLocaleDateString()} · {date.toLocaleTimeString()}
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-1">
        {!notification.isRead && (
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Mark notification as read"
            onClick={() => onMarkRead(notification.id)}
          >
            <span className="size-2 rounded-full bg-primary/60" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-11"
          aria-label="Delete notification"
          onClick={() => onDelete(notification.id)}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function NotificationList({
  notifications,
  isLoading,
  error,
  hasNextPage,
  unreadCount,
  onMarkAllRead,
  onClearAll,
  onLoadNextPage,
  onMarkRead,
  onDelete,
}: {
  notifications: OrderEventNotification[];
  isLoading: boolean;
  error: string | null;
  hasNextPage: boolean;
  unreadCount: number;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onLoadNextPage: () => void;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onMarkAllRead}>
            Mark all read
          </Button>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-11"
          aria-label="Clear all notifications"
          onClick={onClearAll}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {error && <p className="text-destructive text-sm text-center py-4">{error}</p>}

      {isLoading && notifications.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && notifications.length === 0 && !error && (
        <p className="text-muted-foreground py-10 text-center text-sm">
          No notifications here.
        </p>
      )}

      <div className="space-y-2">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onMarkRead={onMarkRead}
            onDelete={onDelete}
          />
        ))}
      </div>

      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={isLoading}
          onClick={onLoadNextPage}
        >
          {isLoading ? "Loading..." : "Load more"}
        </Button>
      )}
    </>
  );
}

export function NotificationCenter({ walletAddress, className }: NotificationCenterProps) {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    hasNextPage,
    loadNextPage,
    markRead,
    markAllRead,
    deleteNotification,
    clearAll,
  } = useNotifications({ walletAddress, filter, search: debouncedSearch });

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell className="text-primary size-5" />
            <CardTitle className="text-base">Notifications</CardTitle>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {unreadCount}
              </Badge>
            )}
          </div>
        </div>

        <div className="relative mt-3">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search notifications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

      </CardHeader>

      <Separator />

      <CardContent className="flex-1 overflow-y-auto pt-4">
        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as NotificationFilter)}
          className="space-y-4"
        >
          <TabsList
            className="grid h-auto w-full grid-cols-4 gap-1 rounded-2xl p-1"
            aria-label="Notification filters"
          >
            {FILTERS.map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="min-h-11">
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {FILTERS.map((item) => (
            <TabsContent
              key={item.id}
              value={item.id}
              className="outline-none"
              aria-label={`${item.label} notifications`}
            >
              <NotificationList
                notifications={notifications}
                isLoading={isLoading}
                error={error}
                hasNextPage={hasNextPage}
                unreadCount={unreadCount}
                onMarkAllRead={() => void markAllRead()}
                onClearAll={clearAll}
                onLoadNextPage={() => void loadNextPage()}
                onMarkRead={(id) => void markRead([id])}
                onDelete={deleteNotification}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
