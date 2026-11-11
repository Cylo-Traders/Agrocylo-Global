import { captureAlert } from '../config/sentry.js';

/**
 * Rolling-window 5xx rate monitor (Issue #756). Only fires when the rate
 * crosses a threshold within a short window, and only once per cooldown, so
 * it's reserved for "something is actually degraded right now" rather than
 * the handful of 500s a totally healthy system produces on an off day.
 */
const WINDOW_MS = 60_000;
const THRESHOLD_COUNT = 10;
const COOLDOWN_MS = 5 * 60_000;

let timestamps: number[] = [];
let lastAlertAt = 0;

export function recordResponseStatus(status: number): void {
  if (status < 500) return;

  const now = Date.now();
  timestamps.push(now);
  timestamps = timestamps.filter((t) => now - t <= WINDOW_MS);

  if (
    timestamps.length >= THRESHOLD_COUNT &&
    now - lastAlertAt >= COOLDOWN_MS
  ) {
    lastAlertAt = now;
    captureAlert(
      'elevated_5xx_rate',
      `${timestamps.length} 5xx responses in the last ${WINDOW_MS / 1000}s`,
      { count: timestamps.length, windowMs: WINDOW_MS },
    );
  }
}

/** Test-only reset so specs don't leak state into each other. */
export function _resetForTests(): void {
  timestamps = [];
  lastAlertAt = 0;
}
