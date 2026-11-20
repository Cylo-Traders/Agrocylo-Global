import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import weatherRoutes from '../routes/weather.js';
import {
  resetWeatherAdvisoryService,
  setPersistedWeatherAdvisories,
  setWeatherAdvisoryProvider,
  WEATHER_FRESH_TTL_MS,
  type WeatherAdvisory,
} from '../services/weatherAdvisoryService.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', weatherRoutes);
  return app;
}

describe('GET /api/v1/weather/advisories (Issue #1341)', () => {
  const app = buildApp();

  beforeEach(() => {
    resetWeatherAdvisoryService();
    delete process.env['WEATHER_ADVISORY_PROVIDER_URL'];
  });

  afterEach(() => {
    resetWeatherAdvisoryService();
    delete process.env['WEATHER_ADVISORY_PROVIDER_URL'];
    vi.restoreAllMocks();
  });

  it('returns status "unavailable" (never pretending conditions are favorable) when no provider or persisted store is configured', async () => {
    const res = await request(app).get('/api/v1/weather/advisories');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'unavailable',
      advisories: [],
      fetchedAt: null,
      source: null,
      stale: false,
      message: expect.stringMatching(/not configured/i),
    });
  });

  it('returns status "ok" with empty advisories and freshness metadata when a configured provider confirms no active alerts', async () => {
    const nowIso = new Date().toISOString();
    setWeatherAdvisoryProvider(async () => ({
      advisories: [],
      fetchedAt: nowIso,
      source: 'agromet-feed',
    }));

    const res = await request(app).get(
      '/api/v1/weather/advisories?lat=6.52&lng=3.37',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      advisories: [],
      fetchedAt: nowIso,
      source: 'agromet-feed',
      stale: false,
    });
  });

  it('filters out expired advisories and keeps active advisories', async () => {
    const now = Date.now();
    const activeAdv: WeatherAdvisory = {
      id: 'active-1',
      severity: 'high',
      type: 'Heavy Rain Warning',
      description: 'Heavy rain expected over the next 24h',
      location: { lat: 6.52, lng: 3.37, name: 'Lagos Basin' },
      issuedAt: new Date(now - 3600_000).toISOString(),
      expiresAt: new Date(now + 3600_000).toISOString(),
    };
    const expiredAdv: WeatherAdvisory = {
      id: 'expired-1',
      severity: 'low',
      type: 'Old Wind Alert',
      description: 'Already passed',
      location: { lat: 6.52, lng: 3.37, name: 'Lagos Basin' },
      issuedAt: new Date(now - 7200_000).toISOString(),
      expiresAt: new Date(now - 1000).toISOString(),
    };

    setPersistedWeatherAdvisories([activeAdv, expiredAdv], {
      fetchedAt: new Date(now).toISOString(),
      source: 'persisted-store',
    });

    const res = await request(app).get('/api/v1/weather/advisories');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.advisories).toHaveLength(1);
    expect(res.body.advisories[0].id).toBe('active-1');
  });

  it('filters advisories by geographic location (lat/lng) and farmerId', async () => {
    const now = Date.now();
    const lagosAdv: WeatherAdvisory = {
      id: 'lagos-1',
      severity: 'moderate',
      type: 'Flood Watch',
      description: 'Coastal flood watch',
      location: { lat: 6.5244, lng: 3.3792, name: 'Lagos' },
      issuedAt: new Date(now).toISOString(),
      farmerId: 'farmer-a',
    };
    const kanoAdv: WeatherAdvisory = {
      id: 'kano-1',
      severity: 'high',
      type: 'Heat Wave',
      description: 'Dry heat alert',
      location: { lat: 12.0022, lng: 8.592, name: 'Kano' },
      issuedAt: new Date(now).toISOString(),
      farmerId: 'farmer-b',
    };

    setPersistedWeatherAdvisories([lagosAdv, kanoAdv], {
      fetchedAt: new Date(now).toISOString(),
      source: 'persisted-store',
    });

    const lagosRes = await request(app).get(
      '/api/v1/weather/advisories?lat=6.5&lng=3.4',
    );
    expect(lagosRes.status).toBe(200);
    expect(lagosRes.body.advisories.map((a: WeatherAdvisory) => a.id)).toEqual([
      'lagos-1',
    ]);

    const farmerBRes = await request(app).get(
      '/api/v1/weather/advisories?farmerId=farmer-b',
    );
    expect(farmerBRes.status).toBe(200);
    expect(
      farmerBRes.body.advisories.map((a: WeatherAdvisory) => a.id),
    ).toEqual(['kano-1']);
  });

  it('marks data as "stale" when fetchedAt is older than the freshness threshold', async () => {
    const staleFetchedAt = new Date(
      Date.now() - WEATHER_FRESH_TTL_MS - 60_000,
    ).toISOString();

    setPersistedWeatherAdvisories([], {
      fetchedAt: staleFetchedAt,
      source: 'persisted-store',
    });

    const res = await request(app).get('/api/v1/weather/advisories');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stale');
    expect(res.body.stale).toBe(true);
    expect(res.body.fetchedAt).toBe(staleFetchedAt);
    expect(res.body.message).toMatch(/freshness threshold/i);
  });

  it('falls back to cached "stale" data when the upstream provider fails after a previous successful fetch', async () => {
    const initialFetchedAt = new Date().toISOString();
    let shouldFail = false;

    setWeatherAdvisoryProvider(async () => {
      if (shouldFail) {
        throw new Error('Upstream provider timeout');
      }
      return {
        advisories: [
          {
            id: 'cached-1',
            severity: 'moderate',
            type: 'Wind Advisory',
            description: 'Gusty winds',
            location: { lat: 6.5, lng: 3.4, name: 'Lagos' },
            issuedAt: initialFetchedAt,
          },
        ],
        fetchedAt: initialFetchedAt,
        source: 'live-weather-api',
      };
    });

    const firstRes = await request(app).get(
      '/api/v1/weather/advisories?lat=6.5&lng=3.4',
    );
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.status).toBe('ok');

    shouldFail = true;
    const fallbackRes = await request(app).get(
      '/api/v1/weather/advisories?lat=6.5&lng=3.4',
    );
    expect(fallbackRes.status).toBe(200);
    expect(fallbackRes.body.status).toBe('stale');
    expect(fallbackRes.body.stale).toBe(true);
    expect(fallbackRes.body.advisories).toHaveLength(1);
    expect(fallbackRes.body.advisories[0].id).toBe('cached-1');
  });

  it('returns status "unavailable" when the upstream provider fails and no cached data exists', async () => {
    setWeatherAdvisoryProvider(async () => {
      throw new Error('Provider HTTP 503');
    });

    const res = await request(app).get(
      '/api/v1/weather/advisories?lat=9.08&lng=7.4',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'unavailable',
      advisories: [],
      fetchedAt: null,
      source: null,
      stale: false,
      message: expect.stringMatching(/temporarily unavailable/i),
    });
  });

  it('derives agricultural advisories when WEATHER_ADVISORY_PROVIDER_URL returns an Open-Meteo style forecast payload', async () => {
    process.env['WEATHER_ADVISORY_PROVIDER_URL'] =
      'https://weather.example.test/v1/forecast';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        latitude: 6.5,
        longitude: 3.4,
        locationName: 'Ikeja Farm Zone',
        current: {
          precipitation: 32.5,
          wind_speed_10m: 50,
          temperature_2m: 29,
        },
      }),
    } as unknown as Response);

    const res = await request(app).get(
      '/api/v1/weather/advisories?lat=6.5&lng=3.4',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.source).toBe('weather.example.test');
    expect(res.body.advisories.map((a: WeatherAdvisory) => a.type)).toEqual(
      expect.arrayContaining(['Heavy Rain Warning', 'High Wind Advisory']),
    );
  });
});
