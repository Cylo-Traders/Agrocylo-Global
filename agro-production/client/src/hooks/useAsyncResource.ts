"use client";

/**
 * A request keyed by its inputs, with the lifecycle states every screen
 * re-implements by hand (#1084).
 *
 * Why this shape: the compiler-visible failure mode in this app was
 * `setLoading(true)` / `setError(null)` written synchronously in a `useEffect`
 * body, which cascades renders and cannot be cancelled. Here the effect only
 * *subscribes* to the request — all state lands in promise callbacks — and
 * "loading" is *derived* from whether the latest result describes the current
 * key. That also makes stale responses harmless: a response for a key that is
 * no longer current is dropped, and the owner's `AbortSignal` aborts the
 * request on unmount or when its inputs change.
 */

import { useCallback, useEffect, useState } from "react";

export interface AsyncResource<T> {
  /** The latest data for the current key, or null while loading/failed. */
  data: T | null;
  /** A human-readable message for the latest failure, or null. */
  error: string | null;
  /** True until the current key has resolved at least once. */
  loading: boolean;
  /** Re-run the request for the current key (retry buttons, live refresh). */
  reload: () => void;
}

interface Snapshot<T> {
  key: string;
  attempt: number;
  data: T | null;
  error: string | null;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

export function useAsyncResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): AsyncResource<T> {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);

  useEffect(() => {
    // Aborting on unmount or key change is what makes an in-flight response
    // inert: the flag is checked before every commit, so a slow response for
    // a previous key can never overwrite the current one.
    const controller = new AbortController();

    load(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setSnapshot({ key, attempt, data, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSnapshot({
          key,
          attempt,
          data: null,
          error: toErrorMessage(error),
        });
      });

    return () => controller.abort();
  }, [key, load, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const loading =
    snapshot === null || snapshot.key !== key || snapshot.attempt !== attempt;

  return {
    data: loading ? null : snapshot?.data ?? null,
    error: loading ? null : snapshot?.error ?? null,
    loading,
    reload,
  };
}
