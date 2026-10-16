import { z } from 'zod';
import { ApiError } from '../http/errors.js';
import logger from '../config/logger.js';

/**
 * Consent-respecting analytics ingestion sink.
 *
 * Payload schema (mirrors client/src/lib/analytics.ts):
 * {
 *   consent?: "granted" | "denied" | "unknown",
 *   events: Array<{
 *     id: string,
 *     name: "page_view" | "click" | ... | "error_occurred",
 *     timestamp?: string (ISO),
 *     sessionId?: string,
 *     anonymousId?: string,
 *     path?: string,
 *     referrer?: string,
 *     properties?: Record<string, string|number|boolean|null>
 *   }>
 * }
 *
 * - consent !== "granted" (when supplied) => nothing is stored.
 * - PII is stripped (emails redacted, wallet/address truncated, strings capped).
 * - Batches capped at MAX_BATCH_EVENTS; oversized payloads rejected with 400.
 * - Store is bounded in-memory (MAX_STORED_EVENTS); swap for provider/DB later.
 */

export const MAX_BATCH_EVENTS = 100;
export const MAX_STORED_EVENTS = 1000;
const MAX_PROP_STRING_LEN = 160;
const MAX_BODY_BYTES = 256 * 1024;

const eventNameSchema = z.enum([
  'page_view',
  'click',
  'hover',
  'scroll_depth',
  'form_submit',
  'transaction_attempt',
  'search_query',
  'filter_usage',
  'feature_adoption',
  'funnel_step',
  'wallet_connected',
  'wallet_disconnected',
  'theme_toggled',
  'consent_changed',
  'error_occurred',
]);

const analyticsEventSchema = z.object({
  id: z.string().min(1).max(128),
  name: eventNameSchema,
  timestamp: z.string().datetime({ offset: true }).optional(),
  sessionId: z.string().max(128).optional(),
  anonymousId: z.string().max(128).optional(),
  path: z.string().max(512).optional(),
  referrer: z.string().max(512).optional(),
  properties: z.record(z.string().max(64), z.union([z.string().max(1024), z.number(), z.boolean(), z.null()])).optional(),
});

const analyticsBatchSchema = z.object({
  consent: z.enum(['granted', 'denied', 'unknown']).optional(),
  events: z.array(analyticsEventSchema).min(1).max(MAX_BATCH_EVENTS),
});

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

export interface StoredAnalyticsEvent {
  id: string;
  name: string;
  timestamp: string;
  sessionId?: string;
  anonymousId?: string;
  path?: string;
  referrer?: string;
  properties: Record<string, string | number | boolean | null>;
}

const store: StoredAnalyticsEvent[] = [];

export function getAnalyticsStore(): StoredAnalyticsEvent[] {
  return store;
}

export function clearAnalyticsStore(): void {
  store.length = 0;
}

function maskAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

function sanitizeValue(key: string, value: string | number | boolean | null): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let next = value.trim().slice(0, MAX_PROP_STRING_LEN);
  const lowered = key.toLowerCase();
  if (lowered.includes('email')) {
    const [name, domain] = next.split('@');
    if (!domain) return 'redacted';
    return `${name.slice(0, 2)}***@${domain}`;
  }
  if (lowered.includes('address') || lowered.includes('wallet')) {
    return maskAddress(next);
  }
  // Strip obvious secrets/tokens
  if (lowered.includes('token') || lowered.includes('secret') || lowered.includes('password') || lowered.includes('signature')) {
    return 'redacted';
  }
  return next;
}

function sanitizeProperties(
  properties: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> {
  if (!properties) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key.length > 64) continue;
    out[key] = sanitizeValue(key, value);
  }
  return out;
}

export function ingestAnalyticsBatch(body: unknown, rawBodySize?: number): { stored: number; skipped: number } {
  if (typeof rawBodySize === 'number' && rawBodySize > MAX_BODY_BYTES) {
    throw new ApiError(400, 'Bad Request', `Analytics payload exceeds ${MAX_BODY_BYTES} bytes`, 'https://cylos.io/errors/validation');
  }
  const parsed = analyticsBatchSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Bad Request', parsed.error.message, 'https://cylos.io/errors/validation');
  }
  const { consent, events } = parsed.data;

  // Respect consent: never store when consent is not granted.
  if (consent && consent !== 'granted') {
    logger.info('Analytics batch skipped (no consent)', { count: events.length, consent });
    return { stored: 0, skipped: events.length };
  }

  for (const event of events) {
    const stored: StoredAnalyticsEvent = {
      id: event.id,
      name: event.name,
      timestamp: event.timestamp ?? new Date().toISOString(),
      sessionId: event.sessionId,
      anonymousId: event.anonymousId,
      path: event.path?.slice(0, 512),
      referrer: event.referrer?.slice(0, 512),
      properties: sanitizeProperties(event.properties),
    };
    store.push(stored);
  }
  // Bound the store.
  if (store.length > MAX_STORED_EVENTS) {
    store.splice(0, store.length - MAX_STORED_EVENTS);
  }

  logger.info('Analytics batch ingested', { count: events.length, stored: store.length });
  return { stored: events.length, skipped: 0 };
}
