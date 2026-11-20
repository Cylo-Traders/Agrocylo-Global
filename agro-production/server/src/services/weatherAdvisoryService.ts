import { config } from '../config/index.js';
import logger from '../config/logger.js';

export type WeatherAdvisorySeverity = 'low' | 'moderate' | 'high' | 'extreme';

export interface WeatherAdvisory {
  id: string;
  severity: WeatherAdvisorySeverity;
  type: string;
  description: string;
  location: {
    lat: number;
    lng: number;
    name: string;
  };
  issuedAt: string;
  expiresAt?: string;
  farmerId?: string;
}

export type WeatherAdvisoryStatus = 'ok' | 'stale' | 'unavailable';

export interface WeatherAdvisoriesResult {
  status: WeatherAdvisoryStatus;
  advisories: WeatherAdvisory[];
  fetchedAt: string | null;
  source: string | null;
  stale: boolean;
  message?: string;
}

export interface WeatherAdvisoryQuery {
  farmerId?: string;
  lat?: number;
  lng?: number;
  maxDistanceKm?: number;
}

export interface WeatherProviderSnapshot {
  advisories: WeatherAdvisory[];
  fetchedAt?: string;
  source?: string;
}

export type WeatherAdvisoryProvider = (
  query: WeatherAdvisoryQuery,
) => Promise<WeatherProviderSnapshot>;

/**
 * Advisories older than 15 minutes are considered stale; beyond 2 hours without
 * a successful refresh they are treated as unavailable unless explicitly persisted.
 */
export const WEATHER_FRESH_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_LOCATION_RADIUS_KM = 100;

interface CachedAdvisoryEntry {
  advisories: WeatherAdvisory[];
  fetchedAt: string;
  source: string;
}

let customProvider: WeatherAdvisoryProvider | null = null;
let persistedStore: CachedAdvisoryEntry | null = null;
const queryCache = new Map<string, CachedAdvisoryEntry>();

export function setWeatherAdvisoryProvider(
  provider: WeatherAdvisoryProvider | null,
): void {
  customProvider = provider;
}

export function setPersistedWeatherAdvisories(
  advisories: WeatherAdvisory[],
  options?: { fetchedAt?: string; source?: string },
): void {
  persistedStore = {
    advisories: [...advisories],
    fetchedAt: options?.fetchedAt ?? new Date().toISOString(),
    source: options?.source ?? 'persisted-store',
  };
}

export function resetWeatherAdvisoryService(): void {
  customProvider = null;
  persistedStore = null;
  queryCache.clear();
}

/**
 * Great-circle Haversine distance in kilometers between two coordinates.
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

/**
 * Filters advisories by expiration timestamp, farmerId (if targeted), and
 * geographic proximity when `lat`/`lng` are supplied.
 */
export function filterActiveAdvisories(
  advisories: WeatherAdvisory[],
  query: WeatherAdvisoryQuery,
  nowMs: number = Date.now(),
): WeatherAdvisory[] {
  const radiusKm = query.maxDistanceKm ?? DEFAULT_LOCATION_RADIUS_KM;

  return advisories.filter((adv) => {
    if (adv.expiresAt) {
      const expiresMs = Date.parse(adv.expiresAt);
      if (!Number.isNaN(expiresMs) && expiresMs <= nowMs) {
        return false;
      }
    }

    if (query.farmerId && adv.farmerId && adv.farmerId !== query.farmerId) {
      return false;
    }

    if (
      query.lat !== undefined &&
      query.lng !== undefined &&
      Number.isFinite(adv.location.lat) &&
      Number.isFinite(adv.location.lng)
    ) {
      const distKm = haversineDistanceKm(
        query.lat,
        query.lng,
        adv.location.lat,
        adv.location.lng,
      );
      if (distKm > radiusKm) {
        return false;
      }
    }

    return true;
  });
}

function isFreshTimestamp(fetchedAt: string, nowMs: number): boolean {
  const parsed = Date.parse(fetchedAt);
  if (Number.isNaN(parsed)) return false;
  return nowMs - parsed <= WEATHER_FRESH_TTL_MS;
}

function buildCacheKey(query: WeatherAdvisoryQuery): string {
  const latKey = query.lat !== undefined ? query.lat.toFixed(2) : 'all';
  const lngKey = query.lng !== undefined ? query.lng.toFixed(2) : 'all';
  return `${query.farmerId ?? 'all'}|${latKey}|${lngKey}`;
}

function isValidSeverity(val: unknown): val is WeatherAdvisorySeverity {
  return (
    val === 'low' || val === 'moderate' || val === 'high' || val === 'extreme'
  );
}

function normalizeProviderAdvisory(
  raw: Record<string, unknown>,
  fallbackLocation: { lat: number; lng: number },
  index: number,
): WeatherAdvisory | null {
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : `adv-${index + 1}`;
  const severity: WeatherAdvisorySeverity = isValidSeverity(raw.severity)
    ? raw.severity
    : 'low';
  const type =
    typeof raw.type === 'string' && raw.type.trim() ? raw.type.trim() : '';
  const description =
    typeof raw.description === 'string' && raw.description.trim()
      ? raw.description.trim()
      : '';

  if (!type || !description) {
    return null;
  }

  const rawLoc =
    raw.location && typeof raw.location === 'object'
      ? (raw.location as Record<string, unknown>)
      : {};
  const lat =
    typeof rawLoc.lat === 'number' && Number.isFinite(rawLoc.lat)
      ? rawLoc.lat
      : fallbackLocation.lat;
  const lng =
    typeof rawLoc.lng === 'number' && Number.isFinite(rawLoc.lng)
      ? rawLoc.lng
      : fallbackLocation.lng;
  const name =
    typeof rawLoc.name === 'string' && rawLoc.name.trim()
      ? rawLoc.name.trim()
      : `${lat.toFixed(2)}, ${lng.toFixed(2)}`;

  const issuedAt =
    typeof raw.issuedAt === 'string' && !Number.isNaN(Date.parse(raw.issuedAt))
      ? raw.issuedAt
      : new Date().toISOString();
  const expiresAt =
    typeof raw.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(raw.expiresAt))
      ? raw.expiresAt
      : undefined;
  const farmerId =
    typeof raw.farmerId === 'string' && raw.farmerId.trim()
      ? raw.farmerId.trim()
      : undefined;

  return {
    id,
    severity,
    type,
    description,
    location: { lat, lng, name },
    issuedAt,
    ...(expiresAt ? { expiresAt } : {}),
    ...(farmerId ? { farmerId } : {}),
  };
}

/**
 * Derives agricultural advisories from an Open-Meteo style forecast payload
 * (`current` or `daily` metrics) when an operator points
 * `WEATHER_ADVISORY_PROVIDER_URL` at a meteorological forecast API.
 */
function deriveAdvisoriesFromForecast(
  payload: Record<string, unknown>,
  fallbackLocation: { lat: number; lng: number },
  nowIso: string,
): WeatherAdvisory[] {
  const lat =
    typeof payload.latitude === 'number'
      ? payload.latitude
      : fallbackLocation.lat;
  const lng =
    typeof payload.longitude === 'number'
      ? payload.longitude
      : fallbackLocation.lng;
  const locationName =
    typeof payload.locationName === 'string' && payload.locationName.trim()
      ? payload.locationName.trim()
      : `Region (${lat.toFixed(2)}, ${lng.toFixed(2)})`;

  const current =
    payload.current && typeof payload.current === 'object'
      ? (payload.current as Record<string, unknown>)
      : {};
  const daily =
    payload.daily && typeof payload.daily === 'object'
      ? (payload.daily as Record<string, unknown>)
      : {};

  const firstNumber = (val: unknown): number | undefined => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (
      Array.isArray(val) &&
      typeof val[0] === 'number' &&
      Number.isFinite(val[0])
    ) {
      return val[0];
    }
    return undefined;
  };

  const precipitationMm =
    firstNumber(current.precipitation) ?? firstNumber(daily.precipitation_sum);
  const windKmh =
    firstNumber(current.wind_speed_10m) ??
    firstNumber(daily.wind_speed_10m_max);
  const maxTempC =
    firstNumber(current.temperature_2m) ??
    firstNumber(daily.temperature_2m_max);
  const minTempC = firstNumber(daily.temperature_2m_min);

  const expiresIso = new Date(
    Date.parse(nowIso) + 24 * 60 * 60 * 1000,
  ).toISOString();
  const derived: WeatherAdvisory[] = [];

  if (precipitationMm !== undefined && precipitationMm >= 25) {
    derived.push({
      id: `rain-${lat.toFixed(2)}-${lng.toFixed(2)}`,
      severity: precipitationMm >= 50 ? 'extreme' : 'high',
      type: 'Heavy Rain Warning',
      description: `Forecast precipitation of ${precipitationMm.toFixed(1)} mm may cause field waterlogging and delayed harvest operations.`,
      location: { lat, lng, name: locationName },
      issuedAt: nowIso,
      expiresAt: expiresIso,
    });
  }

  if (windKmh !== undefined && windKmh >= 45) {
    derived.push({
      id: `wind-${lat.toFixed(2)}-${lng.toFixed(2)}`,
      severity: windKmh >= 70 ? 'extreme' : 'moderate',
      type: 'High Wind Advisory',
      description: `Sustained winds or gusts up to ${windKmh.toFixed(0)} km/h expected; secure storage structures and tall crops.`,
      location: { lat, lng, name: locationName },
      issuedAt: nowIso,
      expiresAt: expiresIso,
    });
  }

  if (maxTempC !== undefined && maxTempC >= 38) {
    derived.push({
      id: `heat-${lat.toFixed(2)}-${lng.toFixed(2)}`,
      severity: maxTempC >= 42 ? 'extreme' : 'high',
      type: 'Extreme Heat Advisory',
      description: `Peak temperature of ${maxTempC.toFixed(1)}°C increases crop evapotranspiration and heat stress risk.`,
      location: { lat, lng, name: locationName },
      issuedAt: nowIso,
      expiresAt: expiresIso,
    });
  }

  if (minTempC !== undefined && minTempC <= 2) {
    derived.push({
      id: `frost-${lat.toFixed(2)}-${lng.toFixed(2)}`,
      severity: minTempC <= 0 ? 'high' : 'moderate',
      type: 'Frost Advisory',
      description: `Minimum temperature of ${minTempC.toFixed(1)}°C may damage frost-sensitive crops.`,
      location: { lat, lng, name: locationName },
      issuedAt: nowIso,
      expiresAt: expiresIso,
    });
  }

  return derived;
}

async function fetchFromHttpProvider(
  providerUrl: string,
  query: WeatherAdvisoryQuery,
): Promise<WeatherProviderSnapshot> {
  const url = new URL(providerUrl);
  if (query.farmerId) {
    url.searchParams.set('farmerId', query.farmerId);
  }
  if (query.lat !== undefined) {
    url.searchParams.set('lat', String(query.lat));
    url.searchParams.set('latitude', String(query.lat));
  }
  if (query.lng !== undefined) {
    url.searchParams.set('lng', String(query.lng));
    url.searchParams.set('longitude', String(query.lng));
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Weather provider responded with HTTP ${response.status}`);
  }

  const rawBody: unknown = await response.json();
  const nowIso = new Date().toISOString();
  const fallbackLocation = {
    lat: query.lat ?? 0,
    lng: query.lng ?? 0,
  };

  if (Array.isArray(rawBody)) {
    const advisories = rawBody
      .map((item, idx) =>
        item && typeof item === 'object'
          ? normalizeProviderAdvisory(
              item as Record<string, unknown>,
              fallbackLocation,
              idx,
            )
          : null,
      )
      .filter((item): item is WeatherAdvisory => item !== null);
    return {
      advisories,
      fetchedAt: nowIso,
      source: url.hostname || 'http-provider',
    };
  }

  if (rawBody && typeof rawBody === 'object') {
    const record = rawBody as Record<string, unknown>;
    const fetchedAt =
      typeof record.fetchedAt === 'string' &&
      !Number.isNaN(Date.parse(record.fetchedAt))
        ? record.fetchedAt
        : nowIso;
    const source =
      typeof record.source === 'string' && record.source.trim()
        ? record.source.trim()
        : url.hostname || 'http-provider';

    if (Array.isArray(record.advisories)) {
      const advisories = record.advisories
        .map((item, idx) =>
          item && typeof item === 'object'
            ? normalizeProviderAdvisory(
                item as Record<string, unknown>,
                fallbackLocation,
                idx,
              )
            : null,
        )
        .filter((item): item is WeatherAdvisory => item !== null);
      return { advisories, fetchedAt, source };
    }

    if (record.current || record.daily) {
      const advisories = deriveAdvisoriesFromForecast(
        record,
        fallbackLocation,
        fetchedAt,
      );
      return { advisories, fetchedAt, source };
    }
  }

  throw new Error('Weather provider returned an unrecognized payload format');
}

/**
 * Resolves weather advisories for the requested farmer/location, explicitly
 * distinguishing verified no-advisory conditions (`status: "ok"`) from
 * stale (`status: "stale"`) and unconfigured/failed (`status: "unavailable"`)
 * states.
 */
export async function getWeatherAdvisories(
  query: WeatherAdvisoryQuery,
  nowMs: number = Date.now(),
): Promise<WeatherAdvisoriesResult> {
  const providerUrl =
    process.env['WEATHER_ADVISORY_PROVIDER_URL']?.trim() ||
    config.weatherAdvisoryProviderUrl.trim();
  const activeProvider: WeatherAdvisoryProvider | null =
    customProvider ??
    (providerUrl
      ? (q: WeatherAdvisoryQuery) => fetchFromHttpProvider(providerUrl, q)
      : null);

  const cacheKey = buildCacheKey(query);

  if (activeProvider) {
    try {
      const snapshot = await activeProvider(query);
      const fetchedAt =
        snapshot.fetchedAt && !Number.isNaN(Date.parse(snapshot.fetchedAt))
          ? snapshot.fetchedAt
          : new Date(nowMs).toISOString();
      const source = snapshot.source ?? 'weather-provider';

      const entry: CachedAdvisoryEntry = {
        advisories: snapshot.advisories,
        fetchedAt,
        source,
      };
      queryCache.set(cacheKey, entry);

      const filtered = filterActiveAdvisories(
        snapshot.advisories,
        query,
        nowMs,
      );
      const fresh = isFreshTimestamp(fetchedAt, nowMs);

      return {
        status: fresh ? 'ok' : 'stale',
        advisories: filtered,
        fetchedAt,
        source,
        stale: !fresh,
        ...(!fresh
          ? {
              message:
                'Weather advisory data is older than the freshness threshold.',
            }
          : {}),
      };
    } catch (err) {
      logger.warn('[Weather] Provider fetch failed', {
        error: err instanceof Error ? err.message : String(err),
        query,
      });

      const cached = queryCache.get(cacheKey) ?? persistedStore;
      if (cached) {
        return {
          status: 'stale',
          advisories: filterActiveAdvisories(cached.advisories, query, nowMs),
          fetchedAt: cached.fetchedAt,
          source: cached.source,
          stale: true,
          message:
            'Live weather provider unavailable; showing last known advisory data.',
        };
      }

      return {
        status: 'unavailable',
        advisories: [],
        fetchedAt: null,
        source: null,
        stale: false,
        message: 'Weather advisory service is temporarily unavailable.',
      };
    }
  }

  if (persistedStore) {
    const fresh = isFreshTimestamp(persistedStore.fetchedAt, nowMs);
    return {
      status: fresh ? 'ok' : 'stale',
      advisories: filterActiveAdvisories(
        persistedStore.advisories,
        query,
        nowMs,
      ),
      fetchedAt: persistedStore.fetchedAt,
      source: persistedStore.source,
      stale: !fresh,
      ...(!fresh
        ? {
            message:
              'Persisted weather advisory data is older than the freshness threshold.',
          }
        : {}),
    };
  }

  return {
    status: 'unavailable',
    advisories: [],
    fetchedAt: null,
    source: null,
    stale: false,
    message:
      'Weather advisory data source is not configured; current conditions cannot be verified.',
  };
}
