import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

vi.mock('../config/database.js', () => ({
  prisma: {
    location: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const { prisma } = await import('../config/database.js');
const { default: locationRoutes, locationErrorHandler } = await import('./locationRoutes.js');

const app = express();
app.use(express.json());
app.use(locationRoutes);
app.use(locationErrorHandler);

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const bearer = (walletAddress = WALLET) =>
  `Bearer ${jwt.sign({ walletAddress }, JWT_SECRET)}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /locations auth + idempotency (#1138)', () => {
  it('succeeds with a valid session and retries are safe (upsert)', async () => {
    vi.mocked(prisma.location.upsert).mockResolvedValue({ walletAddress: WALLET, lat: 6.5, lng: 3.3 } as never);
    const payload = { lat: 6.5, lng: 3.3 };
    const first = await request(app).post('/locations').set('Authorization', bearer()).send(payload);
    expect(first.status).toBe(201);
    const second = await request(app).post('/locations').set('Authorization', bearer()).send(payload);
    expect(second.status).toBe(201);
    expect(vi.mocked(prisma.location.upsert)).toHaveBeenCalledTimes(2);
  });

  it('fails clearly without auth as Problem+JSON 401', async () => {
    const res = await request(app).post('/locations').send({ lat: 6.5, lng: 3.3 });
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('rejects body wallet mismatch with 403', async () => {
    const res = await request(app)
      .post('/locations')
      .set('Authorization', bearer())
      .send({ lat: 6.5, lng: 3.3, wallet_address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('GET /locations/me (#1137)', () => {
  it('returns the caller saved location', async () => {
    vi.mocked(prisma.location.findUnique).mockResolvedValue({ walletAddress: WALLET, lat: 6.5, lng: 3.3 } as never);
    const res = await request(app).get('/locations/me').set('Authorization', bearer());
    expect(res.status).toBe(200);
    expect(res.body.lat).toBe(6.5);
  });

  it('returns 404 Problem+JSON when nothing saved', async () => {
    vi.mocked(prisma.location.findUnique).mockResolvedValue(null);
    const res = await request(app).get('/locations/me').set('Authorization', bearer());
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/locations/me');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});
