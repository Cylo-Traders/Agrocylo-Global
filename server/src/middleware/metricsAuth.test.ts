import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mockConfig = {
  metricsApiKey: 'metrics-secret',
  nodeEnv: 'test',
};

vi.mock('../config/index.js', () => ({
  get config() {
    return mockConfig;
  },
}));

import { requireMetricsAuth } from './metricsAuth.js';

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

describe('requireMetricsAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.METRICS_API_KEY;
    mockConfig.metricsApiKey = 'metrics-secret';
    mockConfig.nodeEnv = 'test';
    process.env.NODE_ENV = 'test';
  });

  describe('when METRICS_API_KEY is configured', () => {
    it('accepts the configured bearer key in Authorization header', () => {
      const req = {
        header: vi.fn((name: string) =>
          name.toLowerCase() === 'authorization' ? 'Bearer metrics-secret' : undefined
        ),
      } as unknown as Request;
      const next = vi.fn() as NextFunction;
      requireMetricsAuth(req, response(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('accepts the configured key in x-api-key header', () => {
      const req = {
        header: vi.fn((name: string) =>
          name.toLowerCase() === 'x-api-key' ? 'metrics-secret' : undefined
        ),
      } as unknown as Request;
      const next = vi.fn() as NextFunction;
      requireMetricsAuth(req, response(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects a request with an invalid key', () => {
      const req = {
        header: vi.fn((name: string) =>
          name.toLowerCase() === 'authorization' ? 'Bearer wrong-secret' : undefined
        ),
      } as unknown as Request;
      const res = response();
      const next = vi.fn() as NextFunction;
      requireMetricsAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a request without credentials', () => {
      const req = { header: vi.fn().mockReturnValue(undefined) } as unknown as Request;
      const res = response();
      const next = vi.fn() as NextFunction;
      requireMetricsAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('when METRICS_API_KEY is unset/missing', () => {
    it('fails closed (401) in production environment', () => {
      mockConfig.metricsApiKey = '';
      mockConfig.nodeEnv = 'production';
      process.env.NODE_ENV = 'production';

      const req = { header: vi.fn().mockReturnValue(undefined) } as unknown as Request;
      const res = response();
      const next = vi.fn() as NextFunction;

      requireMetricsAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized: METRICS_API_KEY is not configured',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('allows open access with warning in development/test environments', () => {
      mockConfig.metricsApiKey = '';
      mockConfig.nodeEnv = 'development';
      process.env.NODE_ENV = 'development';

      const req = { header: vi.fn().mockReturnValue(undefined) } as unknown as Request;
      const res = response();
      const next = vi.fn() as NextFunction;

      requireMetricsAuth(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
