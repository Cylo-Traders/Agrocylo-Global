/**
 * Weather advisory source (Issue #1341).
 *
 * Advisories come from an operator-configured provider feed
 * (`WEATHER_ADVISORY_PROVIDER_URL`). The feed must return JSON — either an
 * array of advisories or `{ "advisories": [...] }` — matching
 * `WeatherAdvisorySchema`. Responses are cached for `cacheTtlMs`; when a
 * refresh fails, the last good snapshot is served as `stale` until it is
 * older than `maxStaleMs`, after which the result is `unavailable`.
 *
 * The result always carries an explicit `status` so clients can tell
 * "fetched, nothing active" (`ok` + empty list) apart from "we do not know"
 * (`unavailable`) — an empty list alone never implies favorable conditions.
 */

import { z } from 'zod';
import logger from '../config/logger.js';

export const WeatherAdvisorySchema = z.object({
  id: z.string(),
  severity: z.enum(['low', 'moderate', 'high', 'extreme']),
  type: z.string(),
  description: z.string(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    name: z.string(),
  }),
  issuedAt: z.string(),
  expiresAt: z.string().optional(),
});

export type WeatherAdvisory = z.infer<typeof WeatherAdvisorySchema>;

const ProviderFeedSchema = z.union([
  z.array(WeatherAdvisorySchema),
  z.object({ advisories: z.array(WeatherAdvisorySchema) }),
]);

export type AdvisoryDataStatus = 'ok' | 'stale' | 'unavailable';

export type UnavailableReason =
  'provider_not_configured' | 'provider_error' | 'data_expired';

export interface AdvisoryResult {
  status: AdvisoryDataStatus;
  advisories: WeatherAdvisory[];
  /** When the underlying snapshot was fetched from the provider. */
  fetchedAt: string | null;
  /** Age of the snapshot in whole seconds, or null when there is none. */
  ageSeconds: number | null;
  /** Present when status is `stale` or `unavailable`. */
  reason?: UnavailableReason;
  /** Radius used for location filtering, when a location was supplied. */
  radiusKm?: number;
}

export interface WeatherAdvisoryServiceOptions {
  providerUrl: string;
  providerApiKey?: string;
  cacheTtlMs: number;
  maxStaleMs: number;
  defaultRadiusKm: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface AdvisoryQuery {
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

interface Snapshot {
  advisories: WeatherAdvisory[];
  fetchedAt: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class WeatherAdvisoryService {
  private snapshot: Snapshot | null = null;
  private inflight: Promise<void> | null = null;
  private lastError: unknown = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: WeatherAdvisoryServiceOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  get isConfigured(): boolean {
    return this.opts.providerUrl.length > 0;
  }

  async getAdvisories(query: AdvisoryQuery = {}): Promise<AdvisoryResult> {
    if (!this.isConfigured) {
      return {
        status: 'unavailable',
        advisories: [],
        fetchedAt: null,
        ageSeconds: null,
        reason: 'provider_not_configured',
      };
    }

    let refreshFailed = false;
    if (!this.snapshot || this.ageMs(this.snapshot) >= this.opts.cacheTtlMs) {
      refreshFailed = !(await this.refresh());
    }

    const snap = this.snapshot;
    if (!snap) {
      return {
        status: 'unavailable',
        advisories: [],
        fetchedAt: null,
        ageSeconds: null,
        reason: 'provider_error',
      };
    }

    const ageMs = this.ageMs(snap);
    const base = {
      fetchedAt: new Date(snap.fetchedAt).toISOString(),
      ageSeconds: Math.floor(ageMs / 1000),
    };

    if (ageMs > this.opts.maxStaleMs) {
      // Too old to trust — do not present it as current conditions.
      return {
        status: 'unavailable',
        advisories: [],
        ...base,
        reason: refreshFailed ? 'provider_error' : 'data_expired',
      };
    }

    const radiusKm = query.radiusKm ?? this.opts.defaultRadiusKm;
    const hasLocation = query.lat !== undefined && query.lng !== undefined;
    const advisories = this.filter(snap.advisories, query, radiusKm);

    return {
      status: refreshFailed ? 'stale' : 'ok',
      advisories,
      ...base,
      ...(refreshFailed ? { reason: 'provider_error' as const } : {}),
      ...(hasLocation ? { radiusKm } : {}),
    };
  }

  /** Drop cached data (tests / operator tooling). */
  reset(): void {
    this.snapshot = null;
    this.inflight = null;
    this.lastError = null;
  }

  private ageMs(snap: Snapshot): number {
    return Math.max(0, this.now() - snap.fetchedAt);
  }

  private filter(
    advisories: WeatherAdvisory[],
    query: AdvisoryQuery,
    radiusKm: number,
  ): WeatherAdvisory[] {
    const nowMs = this.now();
    return advisories.filter((adv) => {
      if (adv.expiresAt) {
        const exp = Date.parse(adv.expiresAt);
        if (Number.isFinite(exp) && exp <= nowMs) return false;
      }
      if (query.lat !== undefined && query.lng !== undefined) {
        const d = haversineKm({ lat: query.lat, lng: query.lng }, adv.location);
        if (d > radiusKm) return false;
      }
      return true;
    });
  }

  /** Returns true when a fresh snapshot was stored. */
  private async refresh(): Promise<boolean> {
    if (!this.inflight) {
      this.inflight = this.fetchFeed()
        .then((advisories) => {
          this.snapshot = { advisories, fetchedAt: this.now() };
          this.lastError = null;
        })
        .catch((err: unknown) => {
          this.lastError = err;
          logger.warn('[Weather] Advisory provider refresh failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    await this.inflight;
    return this.lastError === null;
  }

  private async fetchFeed(): Promise<WeatherAdvisory[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.opts.providerApiKey) {
        headers.Authorization = `Bearer ${this.opts.providerApiKey}`;
      }
      const res = await this.fetchImpl(this.opts.providerUrl, {
        headers,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`provider responded with HTTP ${res.status}`);
      }
      const body: unknown = await res.json();
      const parsed = ProviderFeedSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error('provider returned an invalid advisory feed');
      }
      return Array.isArray(parsed.data) ? parsed.data : parsed.data.advisories;
    } finally {
      clearTimeout(timer);
    }
  }
}
