"use client";

/**
 * The current time as render-safe state (#1084).
 *
 * Reading `Date.now()` during render is impure: the value can change between
 * two renders of the same UI, so every deadline countdown derived from it is
 * unstable and untestable. This hook takes one reading through a lazy state
 * initializer and refreshes it from a timer (never from render), which makes
 * time-dependent display deterministic under fake timers — in tests, control
 * it with `vi.setSystemTime()` / `vi.advanceTimersByTime()`.
 */

import { useEffect, useState } from "react";

const DEFAULT_RESOLUTION_MS = 60_000;

export function useNow(intervalMs: number = DEFAULT_RESOLUTION_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

export default useNow;
