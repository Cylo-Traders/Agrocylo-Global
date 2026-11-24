import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createRateLimitMock,
  createWalletAuthMock,
} from '../test/helpers/middlewareMocks.js';

vi.mock('../db/client.js', () => ({ prisma: {}, connectDB: vi.fn() }));
vi.mock('../services/wsServer.js', () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
}));
vi.mock('../middleware/walletAuth.js', () => createWalletAuthMock());
vi.mock('../middleware/rateLimit.js', () => createRateLimitMock());

import app from '../app.js';
import {
  AdvisoryListResponseSchema,
  weatherAdvisoryService,
} from './weather.js';

describe('GET /api/v1/weather/advisories (Issue #1341)', () => {
  beforeEach(() => {
    weatherAdvisoryService.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 with an explicit unavailable status when no provider is configured', async () => {
    const res = await request(app)
      .get('/api/v1/weather/advisories')
      .expect(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      advisories: [],
      fetchedAt: null,
      ageSeconds: null,
      reason: 'provider_not_configured',
    });
    expect(res.headers['retry-after']).toBe('60');
    expect(() => AdvisoryListResponseSchema.parse(res.body)).not.toThrow();
  });

  it('returns 200 with status and freshness for provider data', async () => {
    const fetchedAt = new Date().toISOString();
    vi.spyOn(weatherAdvisoryService, 'getAdvisories').mockResolvedValue({
      status: 'ok',
      advisories: [],
      fetchedAt,
      ageSeconds: 12,
      radiusKm: 100,
    });

    const res = await request(app)
      .get('/api/v1/weather/advisories?lat=6.5&lng=3.4&radiusKm=50')
      .expect(200);

    expect(res.body).toMatchObject({ status: 'ok', fetchedAt, ageSeconds: 12 });
    expect(weatherAdvisoryService.getAdvisories).toHaveBeenCalledWith({
      lat: 6.5,
      lng: 3.4,
      radiusKm: 50,
    });
  });

  it('returns 200 for stale data so the client can flag it', async () => {
    vi.spyOn(weatherAdvisoryService, 'getAdvisories').mockResolvedValue({
      status: 'stale',
      advisories: [],
      fetchedAt: new Date().toISOString(),
      ageSeconds: 1800,
      reason: 'provider_error',
    });

    const res = await request(app)
      .get('/api/v1/weather/advisories')
      .expect(200);
    expect(res.body.status).toBe('stale');
  });

  it('rejects lat without lng', async () => {
    await request(app).get('/api/v1/weather/advisories?lat=6.5').expect(400);
  });
});
