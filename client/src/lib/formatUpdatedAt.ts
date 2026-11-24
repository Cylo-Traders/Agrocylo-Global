/**
 * Human-readable "last updated" formatting for product freshness (#1401).
 *
 * The server is the source of truth for `updated_at`; this module only turns
 * that timestamp into buyer-friendly text. It never invents a timestamp:
 * missing or unparseable input yields `null` so callers can render an explicit
 * "unknown" fallback instead of a misleading date.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Parse an ISO/whatever timestamp into epoch ms, or `null` when unusable. */
export function parseTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveLocale(locale?: string): string {
  if (locale) return locale;
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en";
}

/**
 * Localized relative time such as "just now", "5 minutes ago", "3 days ago".
 * Falls back to an absolute localized date for spans longer than ~30 days.
 * Returns `null` for missing/invalid timestamps.
 */
export function formatRelativeTime(
  value?: string | null,
  now: number = Date.now(),
  locale?: string,
): string | null {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) return null;

  const diff = now - timestamp;
  const resolvedLocale = resolveLocale(locale);
  const rtf = new Intl.RelativeTimeFormat(resolvedLocale, { numeric: "auto" });

  // Future timestamps (clock skew) are shown as "just now" rather than a
  // confusing negative relative time.
  if (diff < 45 * SECOND) return rtf.format(0, "second");

  const abs = Math.abs(diff);
  if (abs < MINUTE) return rtf.format(-Math.round(diff / SECOND), "second");
  if (abs < HOUR) return rtf.format(-Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(-Math.round(diff / HOUR), "hour");
  if (abs < 30 * DAY) return rtf.format(-Math.round(diff / DAY), "day");

  return new Intl.DateTimeFormat(resolvedLocale, {
    dateStyle: "medium",
  }).format(timestamp);
}

/**
 * Localized absolute date/time such as "24 Nov 2026, 14:05".
 * Returns `null` for missing/invalid timestamps.
 */
export function formatAbsoluteTime(
  value?: string | null,
  locale?: string,
): string | null {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) return null;
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}