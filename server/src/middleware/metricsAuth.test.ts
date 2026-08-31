import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../config/index.js', () => ({ config: { metricsApiKey: 'metrics-secret' } }));

import { requireMetricsAuth } from './metricsAuth.js';

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

describe('requireMetricsAuth', () => {
  it('rejects a request without credentials', () => {
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
});
