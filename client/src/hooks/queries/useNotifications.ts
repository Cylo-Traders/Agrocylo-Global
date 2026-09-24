"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/hooks/useWallet";
import { queryKeys } from "@/lib/queryKeys";
import {
  listUnreadNotifications,
  markNotificationsRead,
} from "@/services/notification/api";

/** Unread notifications for the connected wallet. */
export function useUnreadNotifications() {
  const { address, connected, authenticated } = useWallet();
  return useQuery({
    queryKey: queryKeys.notifications.unread(address ?? ""),
    queryFn: () => listUnreadNotifications(address!),
    enabled: connected && authenticated && !!address,
    refetchInterval: 30 * 1000,
    staleTime: 0,
  });
}

export function useMarkNotificationsRead() {
  const { address } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => markNotificationsRead(address!, ids),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.notifications.unread(address ?? ""),
      });
    },
  });
}
