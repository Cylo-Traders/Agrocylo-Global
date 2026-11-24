import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  WeatherAdvisoryService,
  haversineKm,
  type WeatherAdvisory,
} from './weatherAdvisoryService.js';

const T0 = Date.parse('2026-11-23T12:00:00.000Z');
const MIN = 60_000;

// Lagos and Abuja are ~525 km apart.
const LAGOS = { lat: 6.5244, lng: 3.3792 };
const ABUJA = { lat: 9.0765, lng: 7.3986 };

function advisory(
  id: string,
  loc: { lat: number; lng: number },
  expiresAt?: number,
): WeatherAdvisory {
  return {
    id,
    severity: 'high',
    type: 'Heavy Rain',
    description: `Advisory ${id}`,
    location: { ...loc, name: id },
    issuedAt: new Date(T0 - 60 * MIN).toISOString(),
    ...(expiresAt !== undefined
      ? { expiresAt: new Date(expiresAt).toISOString() }
      : {}),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('WeatherAdvisoryService (Issue #1341)', () => {
  let now: number;
  let fetchImpl: ReturnType<typeof vi.fn>;

  function makeService(overrides: Partial<{ providerUrl: string }> = {}) {
    return new WeatherAdvisoryService({
      providerUrl: 'https://weather.example/advisories',
      providerApiKey: 'secret',
      cacheTtlMs: 10 * MIN,
      maxStaleMs: 60 * MIN,
      defaultRadiusKm: 100,
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      ...overrides,
    });
  }

  beforeEach(() => {
    now = T0;
    fetchImpl = vi.fn();
  });

  it('reports unavailable (not an empty success) when no provider is configured', async () => {
    const svc = makeService({ providerUrl: '' });
    const r = await svc.getAdvisories();
    expect(r).toEqual({
      status: 'unavailable',
      advisories: [],
      fetchedAt: null,
      ageSeconds: null,
      reason: 'provider_not_configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns ok with an empty list when the provider has no active advisories', async () => {
    fetchImpl.mockResolvedValue(jsonResponse([]));
    const r = await makeService().getAdvisories();
    expect(r.status).toBe('ok');
    expect(r.advisories).toEqual([]);
    expect(r.fetchedAt).toBe(new Date(T0).toISOString());
    expect(r.ageSeconds).toBe(0);
  });

  it('sends the API key and accepts the {advisories} envelope', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse({ advisories: [advisory('a', LAGOS)] }),
    );
    const r = await makeService().getAdvisories();
    expect(r.advisories.map((a) => a.id)).toEqual(['a']);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer secret');
  });

  it('reports unavailable on provider error with no cached snapshot', async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ error: 'boom' }, 502));
    const r = await makeService().getAdvisories();
    expect(r).toMatchObject({
      status: 'unavailable',
      advisories: [],
      reason: 'provider_error',
      fetchedAt: null,
    });
  });

  it('treats a malformed provider feed as an error', async () => {
    fetchImpl.mockResolvedValue(jsonResponse([{ id: 'x', severity: 'nope' }]));
    const r = await makeService().getAdvisories();
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('provider_error');
  });

  it('treats a network failure as an error', async () => {
    fetchImpl.mockRejectedValue(new Error('ECONNRESET'));
    const r = await makeService().getAdvisories();
    expect(r.status).toBe('unavailable');
  });

  it('serves the cache within the TTL without refetching', async () => {
    fetchImpl.mockResolvedValue(jsonResponse([advisory('a', LAGOS)]));
    const svc = makeService();
    await svc.getAdvisories();
    now = T0 + 5 * MIN;
    const r = await svc.getAdvisories();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('ok');
    expect(r.ageSeconds).toBe(300);
  });

  it('serves the last snapshot as stale when a refresh fails, then unavailable once too old', async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse([advisory('a', LAGOS)]));
    const svc = makeService();
    await svc.getAdvisories();

    fetchImpl.mockRejectedValue(new Error('provider down'));
    now = T0 + 20 * MIN; // past TTL, within max stale
    const stale = await svc.getAdvisories();
    expect(stale.status).toBe('stale');
    expect(stale.reason).toBe('provider_error');
    expect(stale.advisories.map((a) => a.id)).toEqual(['a']);
    expect(stale.fetchedAt).toBe(new Date(T0).toISOString());
    expect(stale.ageSeconds).toBe(20 * 60);

    now = T0 + 61 * MIN; // past max stale
    const gone = await svc.getAdvisories();
    expect(gone.status).toBe('unavailable');
    expect(gone.advisories).toEqual([]);
    expect(gone.reason).toBe('provider_error');
    expect(gone.fetchedAt).toBe(new Date(T0).toISOString());
  });

  it('recovers to ok after the provider comes back', async () => {
    fetchImpl.mockRejectedValueOnce(new Error('down'));
    const svc = makeService();
    expect((await svc.getAdvisories()).status).toBe('unavailable');
    fetchImpl.mockResolvedValue(jsonResponse([]));
    expect((await svc.getAdvisories()).status).toBe('ok');
  });

  it('drops expired advisories, including ones that expire while cached', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse([
        advisory('expired', LAGOS, T0 - MIN),
        advisory('soon', LAGOS, T0 + 2 * MIN),
        advisory('open-ended', LAGOS),
      ]),
    );
    const svc = makeService();
    const r1 = await svc.getAdvisories();
    expect(r1.advisories.map((a) => a.id)).toEqual(['soon', 'open-ended']);

    now = T0 + 3 * MIN;
    const r2 = await svc.getAdvisories();
    expect(r2.advisories.map((a) => a.id)).toEqual(['open-ended']);
  });

  it('filters by distance from the requested location', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse([advisory('lagos', LAGOS), advisory('abuja', ABUJA)]),
    );
    const svc = makeService();

    const nearLagos = await svc.getAdvisories(LAGOS);
    expect(nearLagos.advisories.map((a) => a.id)).toEqual(['lagos']);
    expect(nearLagos.radiusKm).toBe(100);

    const wide = await svc.getAdvisories({ ...LAGOS, radiusKm: 1000 });
    expect(wide.advisories.map((a) => a.id).sort()).toEqual(['abuja', 'lagos']);

    const all = await svc.getAdvisories();
    expect(all.advisories).toHaveLength(2);
    expect(all.radiusKm).toBeUndefined();
  });

  it('deduplicates concurrent refreshes', async () => {
    let resolve!: (r: Response) => void;
    fetchImpl.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const svc = makeService();
    const p = Promise.all([svc.getAdvisories(), svc.getAdvisories()]);
    resolve(jsonResponse([]));
    const [a, b] = await p;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
  });
});

describe('haversineKm', () => {
  it('computes Lagos–Abuja distance within a few km', () => {
    expect(haversineKm(LAGOS, ABUJA)).toBeGreaterThan(500);
    expect(haversineKm(LAGOS, ABUJA)).toBeLessThan(550);
  });
});
