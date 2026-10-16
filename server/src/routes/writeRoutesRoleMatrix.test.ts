import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Role matrix for location and demand/supply writes (Issue #1145): who gets
 * 2xx and who gets 401/403. Runs the real routes and services against a
 * mocked Prisma client. Product writes are covered in productRoutes.test.ts.
 *
 * Demand/supply roles come from the caller's stored profile (services check
 * `profile.role`), not from the JWT role claim, so the matrix drives the
 * profile lookup.
 */

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

vi.mock('ioredis', () => ({
  default: class {
    constructor() {
      throw new Error('redis disabled in tests');
    }
  },
}));
vi.mock('../config/database.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    profile: { findUnique: vi.fn() },
    location: { upsert: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    buyerDemand: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    farmerSupply: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

const { prisma } = await import('../config/database.js');
const { default: locationRoutes, locationErrorHandler } = await import('./locationRoutes.js');
const { default: demandSupplyRoutes } = await import('./demandSupplyRoutes.js');
const { apiErrorHandler } = await import('./productRoutes.js');

const app = express();
app.use(express.json());
app.use(locationRoutes);
app.use(demandSupplyRoutes);
app.use(locationErrorHandler);
app.use(apiErrorHandler);

const WALLET = 'gcaller';
const bearer = (role: string, walletAddress = WALLET) =>
  `Bearer ${jwt.sign({ walletAddress, role }, JWT_SECRET)}`;
const ROLES = ['FARMER', 'BUYER', 'ADMIN'] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.location.upsert).mockResolvedValue({ walletAddress: WALLET } as any);
  vi.mocked(prisma.location.update).mockResolvedValue({ walletAddress: WALLET } as any);
  vi.mocked(prisma.location.delete).mockResolvedValue({} as any);
  vi.mocked(prisma.buyerDemand.create).mockResolvedValue({ id: 'd-1' } as any);
  vi.mocked(prisma.farmerSupply.create).mockResolvedValue({ id: 's-1' } as any);
});

describe('location writes (#1145)', () => {
  const body = { lat: 6.5, lng: 3.4, city: 'Lagos', country: 'NG' };

  describe('POST /locations', () => {
    it('rejects anonymous callers with 401', async () => {
      const res = await request(app).post('/locations').send(body);
      expect(res.status).toBe(401);
      expect(prisma.location.upsert).not.toHaveBeenCalled();
    });

    it('rejects BUYER with 403 (#1133)', async () => {
      const res = await request(app).post('/locations').set('Authorization', bearer('BUYER')).send(body);
      expect(res.status).toBe(403);
      expect(res.type).toBe('application/problem+json');
      expect(prisma.location.upsert).not.toHaveBeenCalled();
    });

    it.each(['FARMER', 'ADMIN'] as const)('allows %s to set their own location', async (role) => {
      const res = await request(app)
        .post('/locations')
        .set('Authorization', bearer(role))
        .send(body);
      expect(res.status).toBe(201);
      expect(vi.mocked(prisma.location.upsert).mock.calls[0]![0]!.where).toEqual({
        walletAddress: WALLET,
      });
    });

    it('always writes the caller row, never a wallet named in the body', async () => {
      await request(app)
        .post('/locations')
        .set('Authorization', bearer('FARMER'))
        .send({ ...body, wallet_address: 'gvictim' });
      expect(vi.mocked(prisma.location.upsert).mock.calls[0]?.[0]?.where).toEqual({
        walletAddress: WALLET,
      });
    });

    it('accepts the latitude/longitude spelling and defaults optional fields', async () => {
      const res = await request(app)
        .post('/locations')
        .set('Authorization', bearer('FARMER'))
        .send({ latitude: 6.5, longitude: 3.4 });
      expect(res.status).toBe(201);
      expect(vi.mocked(prisma.location.upsert).mock.calls[0]![0]!.create).toEqual({
        walletAddress: WALLET,
        lat: 6.5,
        lng: 3.4,
        city: null,
        country: null,
        is_public: true,
      });
    });

    it('rejects a payload without a coordinate pair with 400', async () => {
      const res = await request(app)
        .post('/locations')
        .set('Authorization', bearer('FARMER'))
        .send({ city: 'Lagos' });
      expect(res.status).toBe(400);
      expect(prisma.location.upsert).not.toHaveBeenCalled();
    });

  });

  describe.each([
    ['PATCH', 200],
    ['DELETE', 204],
  ] as const)('%s /locations/:wallet_address', (method, okStatus) => {
    const call = (target: string, auth?: string) => {
      const r =
        method === 'PATCH'
          ? request(app).patch(`/locations/${target}`).send({ city: 'Abuja' })
          : request(app).delete(`/locations/${target}`);
      return auth ? r.set('Authorization', auth) : r;
    };
    const write = method === 'PATCH' ? () => prisma.location.update : () => prisma.location.delete;

    it('rejects anonymous callers with 401', async () => {
      expect((await call(WALLET)).status).toBe(401);
      expect(write()).not.toHaveBeenCalled();
    });

    it('rejects BUYER with 403 (#1133)', async () => {
      expect((await call(WALLET, bearer('BUYER'))).status).toBe(403);
      expect(write()).not.toHaveBeenCalled();
    });

    it.each(['FARMER', 'ADMIN'] as const)('allows %s on their own row', async (role) => {
      expect((await call(WALLET, bearer(role))).status).toBe(okStatus);
      expect(write()).toHaveBeenCalledTimes(1);
    });

    it.each(['FARMER', 'ADMIN'] as const)("rejects %s on another wallet's row with 403", async (role) => {
      expect((await call('gsomeoneelse', bearer(role))).status).toBe(403);
      expect(write()).not.toHaveBeenCalled();
    });
  });
});

describe.each([
  {
    path: '/demand',
    allowedRole: 'BUYER',
    body: { crop_name: 'Maize' },
    walletField: 'buyer_wallet',
    create: () => prisma.buyerDemand.create,
  },
  {
    path: '/supply',
    allowedRole: 'FARMER',
    body: { crop_name: 'Maize', quantity_available: '100' },
    walletField: 'farmer_wallet',
    create: () => prisma.farmerSupply.create,
  },
])('POST $path role matrix (#1145)', ({ path, allowedRole, body, walletField, create }) => {
  const post = (auth?: string, payload: object = body) => {
    const r = request(app).post(path).send(payload);
    return auth ? r.set('Authorization', auth) : r;
  };

  it('rejects anonymous callers with 401', async () => {
    expect((await post()).status).toBe(401);
    expect(create()).not.toHaveBeenCalled();
  });

  it.each(ROLES)('profile role %s', async (profileRole) => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({ role: profileRole } as any);
    const res = await post(bearer(profileRole));
    if (profileRole === allowedRole) {
      expect(res.status).toBe(201);
      expect(create()).toHaveBeenCalledTimes(1);
    } else {
      expect(res.status).toBe(403);
      expect(create()).not.toHaveBeenCalled();
    }
  });

  it('enforces the stored profile role, not the JWT role claim', async () => {
    const otherRole = allowedRole === 'BUYER' ? 'FARMER' : 'BUYER';
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({ role: otherRole } as any);
    const res = await post(bearer(allowedRole));
    expect(res.status).toBe(403);
    expect(create()).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller has no profile', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue(null);
    expect((await post(bearer(allowedRole))).status).toBe(404);
    expect(create()).not.toHaveBeenCalled();
  });

  it(`rejects a ${walletField} naming another wallet with 403`, async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({ role: allowedRole } as any);
    const res = await post(bearer(allowedRole), { ...body, [walletField]: 'gsomeoneelse' });
    expect(res.status).toBe(403);
    expect(create()).not.toHaveBeenCalled();
  });
});
