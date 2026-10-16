import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
const add = vi.hoisted(() => vi.fn(async () => ({ id: 'job-1' })));
const findUser = vi.hoisted(() => vi.fn());

// No Redis in unit tests: the limiter falls back to its in-memory store.
vi.mock('ioredis', () => ({
  default: class {
    constructor() {
      throw new Error('redis disabled in tests');
    }
  },
}));
vi.mock('../config/database.js', () => ({ prisma: { user: { findUnique: findUser } } }));
vi.mock('../queues/queues.js', () => ({
  getIndexingQueue: () => ({ add }),
  getAnalyticsQueue: () => ({ add }),
  getNotificationsQueue: () => ({ add }),
}));

const { default: jobRoutes } = await import('./jobRoutes.js');

const app = express();
app.use(express.json());
app.use(jobRoutes);

const token = (role: string) => `Bearer ${jwt.sign({ walletAddress: 'GADMIN', role }, JWT_SECRET)}`;
const validJob = {
  name: 'aggregate-metrics',
  data: { metricName: 'order_count', granularity: 'daily', startDate: '2026-01-01', endDate: '2026-01-02' },
};
const post = (body: unknown, auth?: string, queue = 'analytics') => {
  const r = request(app).post(`/jobs/${queue}`).send(body as object);
  return auth ? r.set('Authorization', auth) : r;
};

describe('POST /jobs/:queue (#953)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUser.mockResolvedValue({ role: 'ADMIN' });
  });

  it('anonymous callers get 401 and nothing is enqueued', async () => {
    const res = await post(validJob);
    expect(res.status).toBe(401);
    expect(add).not.toHaveBeenCalled();
  });

  it('non-admin wallets get 403 and nothing is enqueued', async () => {
    const res = await post(validJob, token('BUYER'));
    expect(res.status).toBe(403);
    expect(add).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported job name', { name: 'default', data: {} }, 'analytics'],
    ['job name from another queue', { name: 'send-email', data: {} }, 'analytics'],
    ['invalid payload', { name: 'aggregate-metrics', data: { granularity: 'yearly' } }, 'analytics'],
    ['bad email address', { name: 'send-email', data: { to: 'nope', subject: 's', body: 'b' } }, 'notifications'],
  ])('rejects %s with 400 before enqueueing', async (_label, body, queue) => {
    const res = await post(body, token('ADMIN'), queue);
    expect(res.status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('admins enqueue the validated job under its real processor name', async () => {
    const res = await post(validJob, token('ADMIN'));
    expect(res.status).toBe(202);
    expect(add).toHaveBeenCalledWith('aggregate-metrics', validJob.data, expect.any(Object));
  });

  it('is rate limited', async () => {
    process.env['ENABLE_TEST_RATE_LIMIT'] = 'true';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) statuses.push((await post(validJob, token('ADMIN'))).status);
      expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      delete process.env['ENABLE_TEST_RATE_LIMIT'];
    }
  });
});
