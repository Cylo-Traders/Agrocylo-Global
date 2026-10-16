import request from 'supertest';
import express from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAnalyticsStore, getAnalyticsStore } from '../services/analyticsService.js';

const { default: analyticsRoutes, analyticsErrorHandler } = await import('./analyticsRoutes.js');

const app = express();
app.use(express.json());
app.use(analyticsRoutes);
app.use(analyticsErrorHandler);

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    name: 'page_view',
    timestamp: new Date().toISOString(),
    sessionId: 's1',
    anonymousId: 'a1',
    path: '/map',
    properties: {},
    ...overrides,
  };
}

describe('POST /api/analytics (#1139)', () => {
  beforeEach(() => {
    clearAnalyticsStore();
  });

  it('stores a granted batch and strips PII', async () => {
    const res = await request(app).post('/api/analytics').send({
      consent: 'granted',
      events: [event({ name: 'search_query', properties: { query: 'maize', email: 'user@example.com', wallet: '0x1111111111111111111111111111111111111111' } })],
    });
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(1);
    const stored = getAnalyticsStore();
    expect(stored).toHaveLength(1);
    expect(String(stored[0]!.properties['email'])).toContain('***@');
    expect(String(stored[0]!.properties['wallet'])).toContain('…');
  });

  it('does not store when consent is denied', async () => {
    const res = await request(app).post('/api/analytics').send({ consent: 'denied', events: [event()] });
    expect(res.status).toBe(202);
    expect(res.body.stored).toBe(0);
    expect(getAnalyticsStore()).toHaveLength(0);
  });

  it('rejects invalid batches with 400 Problem+JSON', async () => {
    const res = await request(app).post('/api/analytics').send({ events: [] });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('rejects oversized batches with 400', async () => {
    const events = Array.from({ length: 101 }, () => event());
    const res = await request(app).post('/api/analytics').send({ consent: 'granted', events });
    expect(res.status).toBe(400);
    expect(getAnalyticsStore()).toHaveLength(0);
  });
});
