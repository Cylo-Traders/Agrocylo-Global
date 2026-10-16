"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import {
  listUnreadNotifications,
  markNotificationsRead,
} from "@/services/notification/api";
import { showOrderEventToast } from "@/services/notification";

const POLL_INTERVAL_MS = 15_000;

// Backoff delays for acknowledgement retries (ms): 15 s, 30 s, 60 s, 120 s, cap 120 s.
const ACK_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000];

/** True for transient failures worth retrying (network, 5xx). */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (/failed to fetch|network|fetch failed/i.test(message)) return true;
  // HTTP errors surfaced as Error with a status property
  const status = (error as { status?: number }).status;
  if (typeof status === "number" && status >= 500) return true;
  return false;
}

/** True for permanent failures that should not be retried (auth, 4xx). */
function isPermanentError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 500) return true;
  return false;
}

export default function NotificationPoller() {
  const router = useRouter();
  const { address, connected } = useWallet();

  /**
   * IDs for which a toast has already been shown.
   * Cleared on wallet/account change.
   */
  const shownToastIdsRef = useRef<Set<string>>(new Set());

  /**
   * IDs that have been toasted but whose server acknowledgement is still
   * outstanding (POST failed or not yet attempted).
   * Cleared on wallet/account change.
   */
  const pendingAckIdsRef = useRef<Set<string>>(new Set());

  /**
   * How many consecutive ack failures have occurred in this session.
   * Used to select the next backoff delay.
   */
  const ackFailureCountRef = useRef(0);

  /**
   * Monotonically incremented each time the effect restarts (address/wallet
   * change). Lets async callbacks detect stale work and bail out.
   */
  const sessionIdRef = useRef(0);

  const isPollingRef = useRef(false);
  const offlineWarnedRef = useRef(false);

  // Reset all state whenever the connected wallet changes.
  useEffect(() => {
    sessionIdRef.current += 1;
    shownToastIdsRef.current = new Set();
    pendingAckIdsRef.current = new Set();
    ackFailureCountRef.current = 0;
    offlineWarnedRef.current = false;
  }, [address]);

  useEffect(() => {
    if (!connected || !address) {
      return;
    }

    const walletAddress = address;
    // Snapshot the session id at effect-start; any async callback can verify
    // it hasn't been superseded by an account change.
    const mySession = sessionIdRef.current;
    let active = true;

    function isStale(): boolean {
      return !active || sessionIdRef.current !== mySession;
    }

    /**
     * Attempt to POST pending acknowledgements. Returns true if all pending
     * IDs were successfully acknowledged (or the set was already empty).
     */
    async function flushPendingAcks(): Promise<boolean> {
      if (pendingAckIdsRef.current.size === 0) return true;

      const ids = [...pendingAckIdsRef.current];
      try {
        await markNotificationsRead(walletAddress, ids);
        if (isStale()) return false;

        // Success — remove from pending and reset failure counter.
        ids.forEach((id) => pendingAckIdsRef.current.delete(id));
        ackFailureCountRef.current = 0;
        return true;
      } catch (error) {
        if (isStale()) return false;

        if (isPermanentError(error)) {
          // Auth / client error: stop retrying these IDs to avoid a hot loop.
          console.error(
            "NotificationPoller: permanent error acknowledging notifications — clearing pending set.",
            error,
          );
          pendingAckIdsRef.current.clear();
          ackFailureCountRef.current = 0;
          return false;
        }

        // Transient failure: keep IDs in pending, increment backoff counter.
        const delay =
          ACK_BACKOFF_MS[
            Math.min(ackFailureCountRef.current, ACK_BACKOFF_MS.length - 1)
          ] ?? ACK_BACKOFF_MS[ACK_BACKOFF_MS.length - 1]!;
        ackFailureCountRef.current += 1;

        if (isRetryableError(error)) {
          if (!offlineWarnedRef.current) {
            offlineWarnedRef.current = true;
            console.warn(
              `NotificationPoller: backend unreachable — ack retry scheduled in ${delay / 1000}s.`,
            );
          }
        } else {
          console.error(
            "NotificationPoller: failed to acknowledge notifications:",
            error,
          );
        }
        return false;
      }
    }

    async function pollNotifications() {
      if (!active || isPollingRef.current) {
        return;
      }

      isPollingRef.current = true;

      try {
        // Always attempt to flush any outstanding acks first — this is the
        // retry path for previously failed acknowledgements.
        await flushPendingAcks();

        if (isStale()) return;

        const notifications = await listUnreadNotifications(walletAddress);
        if (isStale() || notifications.length === 0) return;

        // Separate newly seen notifications from already-toasted ones.
        const untoasted = notifications.filter(
          (n) => !shownToastIdsRef.current.has(n.id),
        );

        if (untoasted.length > 0) {
          untoasted.forEach((n) => {
            shownToastIdsRef.current.add(n.id);
            // Queue for acknowledgement before showing toast so the ID is
            // always in pendingAckIds even if the POST below throws.
            pendingAckIdsRef.current.add(n.id);
            showOrderEventToast(n, (orderId) => {
              router.push(`/orders/${orderId}`);
            });
          });

          // Flush newly queued IDs immediately.
          await flushPendingAcks();
        }
        // If untoasted.length === 0 but pendingAckIds is non-empty, the
        // flushPendingAcks() call at the top of this function already
        // handled the retry — no further work needed here.
      } catch (error) {
        if (isStale()) return;
        if (isRetryableError(error)) {
          if (!offlineWarnedRef.current) {
            offlineWarnedRef.current = true;
            console.warn(
              "NotificationPoller: backend unreachable. Suppressing further errors until next reconnect.",
            );
          }
        } else {
          console.error(
            "NotificationPoller: failed to poll notifications:",
            error,
          );
        }
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
