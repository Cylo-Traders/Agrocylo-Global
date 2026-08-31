import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Response } from 'express';

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  createUsage: vi.fn(),
}));

vi.mock('../config/database.js', () => ({
  prisma: {
    integratorApiKey: { findUnique: db.findUnique, update: db.update },
    integratorApiKeyUsage: { count: db.count, create: db.createUsage },
  },
}));
vi.mock('../config/index.js', () => ({
  config: {
    integratorApiKeyPepper: 'test-pepper-at-least-32-characters-long',
    integratorMonthlyQuota: 2,
  },
}));
vi.mock('../config/logger.js', () => ({ default: { error: vi.fn() } }));

import { hashApiKey, requireIntegratorApiKey, type IntegratorRequest } from './integratorAuth.js';

function request(): IntegratorRequest {
  return {
    header: vi.fn().mockReturnValue('agc_secret'),
    baseUrl: '/integrator/v1',
    path: '/reports/farmers',
    ip: '127.0.0.1',
  } as unknown as IntegratorRequest;
}

function response(): Response & EventEmitter {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    status: vi.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: unknown) {
      return this;
    }),
    setHeader: vi.fn(),
  });
  return res as unknown as Response & EventEmitter;
}

const activeRecord = {
  id: 'key-1',
  revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  organizationName: 'Coop',
  scopedFarmerWallets: ['GFARMER'],
  scopedRegion: null,
};

describe('integrator API key middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.findUnique.mockResolvedValue(activeRecord);
    db.count.mockResolvedValue(0);
    db.update.mockResolvedValue(activeRecord);
    db.createUsage.mockResolvedValue({});
  });

  it('uses a peppered HMAC digest', () => {
    expect(hashApiKey('agc_secret')).toBe(
      createHmac('sha256', 'test-pepper-at-least-32-characters-long')
        .update('agc_secret')
        .digest('hex')
    );
  });

  it('rejects an expired key with 401', async () => {
    db.findUnique.mockResolvedValue({ ...activeRecord, expiresAt: new Date(Date.now() - 1) });
    const res = response();
    const next = vi.fn() as NextFunction;
    await requireIntegratorApiKey(request(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('enforces the per-key monthly quota with Retry-After', async () => {
    db.count.mockResolvedValue(2);
    const res = response();
    await requireIntegratorApiKey(request(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('automatically records usage when the response finishes', async () => {
    const req = request();
    const res = response();
    const next = vi.fn();
    await requireIntegratorApiKey(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    res.emit('finish');
    expect(db.createUsage).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'key-1',
        endpoint: '/integrator/v1/reports/farmers',
        statusCode: 200,
        ipAddress: '127.0.0.1',
      },
    });
  });
});
