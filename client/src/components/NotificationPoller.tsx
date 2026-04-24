"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import {
  listUnreadNotifications,
  markNotificationsRead,
} from "@/services/notification/api";
import { showOrderEventToast } from "@/services/notification";

const POLL_INTERVAL_MS = 15000;

export default function NotificationPoller() {
  const router = useRouter();
  const { address, connected } = useWallet();
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const isPollingRef = useRef(false);

  useEffect(() => {
    seenNotificationIdsRef.current.clear();
  }, [address]);

  useEffect(() => {
    if (!connected || !address) {
      return;
    }

    let active = true;

    async function pollNotifications() {
      if (!active || isPollingRef.current) {
        return;
      }

      isPollingRef.current = true;

      try {
        const notifications = await listUnreadNotifications(address);
        if (!active || notifications.length === 0) {
          return;
        }

        const unseen = notifications.filter(
          (notification) => !seenNotificationIdsRef.current.has(notification.id),
        );

        if (unseen.length === 0) {
          return;
        }

        unseen.forEach((notification) => {
          seenNotificationIdsRef.current.add(notification.id);
          showOrderEventToast(notification, (orderId) => {
            router.push(`/orders/${orderId}`);
          });
        });

        await markNotificationsRead(
          address,
          unseen.map((notification) => notification.id),
        );
      } catch (error) {
        console.error("Failed to poll notifications:", error);
      } finally {
        isPollingRef.current = false;
      }
    }

    void pollNotifications();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void pollNotifications();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [address, connected, router]);

  return null;
}
