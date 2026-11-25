import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';

const mockConfig = vi.hoisted(() => ({
  metricsApiKey: 'metrics-secret',
  nodeEnv: 'development' as 'development' | 'test' | 'production',
}));

vi.mock('../config/index.js', () => ({ config: mockConfig }));

vi.mock('../services/metricsService.js', () => ({
  getPlatformMetrics: vi.fn().mockResolvedValue({ uptimeSeconds: 42 }),
}));

vi.mock('../services/promMetrics.js', () => ({
  registry: {
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
    metrics: vi.fn().mockResolvedValue('# HELP http_requests_total\nhttp_requests_total 1\n'),
  },
}));

import {
  isLoopbackOrPrivateIp,
  requireMetricsAuth,
  resetMetricsAuthWarningsForTests,
} from './metricsAuth.js';
import metricsRoutes from '../routes/metricsRoutes.js';

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

describe('requireMetricsAuth (Issue #1425)', () => {
  const savedEnvKey = process.env.METRICS_API_KEY;
  const savedNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMetricsAuthWarningsForTests();
    mockConfig.metricsApiKey = 'metrics-secret';
    mockConfig.nodeEnv = 'development';
    delete process.env.METRICS_API_KEY;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    if (savedEnvKey === undefined) delete process.env.METRICS_API_KEY;
    else process.env.METRICS_API_KEY = savedEnvKey;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  it('rejects a request without credentials when a key is configured', () => {
    const req = { header: vi.fn().mockReturnValue(undefined) } as unknown as Request;
    const res = response();
    const next = vi.fn() as NextFunction;
    requireMetricsAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts the configured bearer key', () => {
    const req = {
      header: vi.fn((name: string) =>
        name === 'authorization' ? 'Bearer metrics-secret' : undefined
      ),
    } as unknown as Request;
    const next = vi.fn() as NextFunction;
    requireMetricsAuth(req, response(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  describe('production fail-closed behavior on /metrics and /metrics/prom', () => {
    const app = express();
    app.use(metricsRoutes);

    it('fails closed with 503 METRICS_UNAVAILABLE and no metrics body when METRICS_API_KEY is unset in production', async () => {
      mockConfig.nodeEnv = 'production';
      mockConfig.metricsApiKey = '';

      const jsonRes = await request(app).get('/metrics');
      expect(jsonRes.status).toBe(503);
      expect(jsonRes.body).toEqual({
        error: expect.stringMatching(/METRICS_API_KEY is not configured/i),
        code: 'METRICS_UNAVAILABLE',
      });
      expect(jsonRes.body.uptimeSeconds).toBeUndefined();

      const promRes = await request(app).get('/metrics/prom');
      expect(promRes.status).toBe(503);
      expect(promRes.body.code).toBe('METRICS_UNAVAILABLE');
      expect(promRes.text).not.toContain('http_requests_total');
    });

    it('returns 401 and no metrics body when wrong key is provided in production', async () => {
      mockConfig.nodeEnv = 'production';
      mockConfig.metricsApiKey = 'prod-metrics-secret';

      const jsonRes = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer wrong-key');
      expect(jsonRes.status).toBe(401);
      expect(jsonRes.body).toEqual({ error: 'Unauthorized' });

      const promRes = await request(app)
        .get('/metrics/prom')
        .set('x-api-key', 'wrong-key');
      expect(promRes.status).toBe(401);
      expect(promRes.text).not.toContain('http_requests_total');
    });

    it('returns 200 with metrics payload when valid key is provided in production', async () => {
      mockConfig.nodeEnv = 'production';
      mockConfig.metricsApiKey = 'prod-metrics-secret';

      const jsonRes = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer prod-metrics-secret');
      expect(jsonRes.status).toBe(200);
      expect(jsonRes.body).toEqual({ uptimeSeconds: 42 });

      const promRes = await request(app)
        .get('/metrics/prom')
        .set('x-api-key', 'prod-metrics-secret');
      expect(promRes.status).toBe(200);
      expect(promRes.text).toContain('http_requests_total 1');
    });
  });

  describe('development/test loopback & private-network guard when METRICS_API_KEY is unset', () => {
    it('allows local/loopback requests in development when key is unset', () => {
      mockConfig.nodeEnv = 'development';
      mockConfig.metricsApiKey = '';

      const req = {
        ip: '127.0.0.1',
        header: vi.fn().mockReturnValue(undefined),
      } as unknown as Request;
      const res = response();
      const next = vi.fn() as NextFunction;

      requireMetricsAuth(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects public non-private IP requests in development when key is unset', () => {
      mockConfig.nodeEnv = 'development';
      mockConfig.metricsApiKey = '';

      const req = {
        ip: '203.0.113.45',
        header: vi.fn().mockReturnValue(undefined),
      } as unknown as Request;
      const res = response();
      const next = vi.fn() as NextFunction;

      requireMetricsAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('correctly classifies loopback, RFC1918, and public IPs', () => {
      expect(isLoopbackOrPrivateIp('127.0.0.1')).toBe(true);
      expect(isLoopbackOrPrivateIp('::1')).toBe(true);
      expect(isLoopbackOrPrivateIp('::ffff:172.18.0.5')).toBe(true);
      expect(isLoopbackOrPrivateIp('10.0.0.12')).toBe(true);
      expect(isLoopbackOrPrivateIp('192.168.1.10')).toBe(true);
      expect(isLoopbackOrPrivateIp('8.8.8.8')).toBe(false);
      expect(isLoopbackOrPrivateIp('172.32.0.1')).toBe(false);
    });
  });
});
