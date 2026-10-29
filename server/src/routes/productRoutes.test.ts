import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-level contract for /products (Issue #1145): which query parameters the
 * handler actually reads, and who may write. Runs the real route and service
 * against a mocked Prisma client.
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
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    priceHistory: { findMany: vi.fn() },
    profile: { findUnique: vi.fn() },
  },
}));
vi.mock('../services/wsManager.js', () => ({ wsManager: { broadcast: vi.fn() } }));

const { prisma } = await import('../config/database.js');
const { default: productRoutes, apiErrorHandler } = await import('./productRoutes.js');

const app = express();
app.use(express.json());
app.use(productRoutes);
app.use(apiErrorHandler);

const OWNER = 'gfarmer';
const bearer = (role: string, walletAddress = OWNER) =>
  `Bearer ${jwt.sign({ walletAddress, role }, JWT_SECRET)}`;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'prod-1',
  farmerWallet: OWNER,
  name: 'Tomato',
  description: null,
  category: 'Vegetables',
  pricePerUnit: { toString: () => '5' },
  currency: 'USDC',
  unit: 'kg',
  stockQuantity: null,
  location: null,
  imageUrl: null,
  isAvailable: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const validProduct = { name: 'Tomato', price_per_unit: '5', currency: 'USDC', unit: 'kg' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockResolvedValue([0, []] as any);
  vi.mocked(prisma.product.create).mockResolvedValue(row() as any);
  vi.mocked(prisma.product.findUnique).mockResolvedValue(row() as any);
  vi.mocked(prisma.product.update).mockResolvedValue(row() as any);
  vi.mocked(prisma.profile.findUnique).mockResolvedValue({ role: 'FARMER' } as any);
});

describe('GET /products query parameters (#1145)', () => {
  const where = () => vi.mocked(prisma.product.findMany).mock.calls[0]![0]!.where as any;
  const query = () => vi.mocked(prisma.product.findMany).mock.calls[0]![0]! as any;

  it('is public and returns the paged envelope', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([1, [row()]] as any);
    const res = await request(app).get('/products');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, page_size: 20, total: 1, totalPages: 1 });
    expect(res.body.items[0]).toMatchObject({
      id: 'prod-1',
      price_per_unit: '5',
      farmer_wallet: OWNER,
    });
  });

  it('reads search', async () => {
    await request(app).get('/products').query({ search: 'okra' });
    expect(where().OR).toHaveLength(3);
  });

  it('reads category', async () => {
    await request(app).get('/products').query({ category: 'Grains' });
    expect(where().category).toBe('Grains');
  });

  it('reads farmer (seller)', async () => {
    await request(app).get('/products').query({ farmer: 'GSELLER' });
    expect(where().farmerWallet).toBe('gseller');
  });

  it('reads location', async () => {
    await request(app).get('/products').query({ location: 'Accra' });
    expect(where().location).toEqual({ contains: 'Accra', mode: 'insensitive' });
  });

  it('reads minPrice and maxPrice', async () => {
    await request(app).get('/products').query({ minPrice: '2', maxPrice: '8' });
    expect(String(where().pricePerUnit.gte)).toBe('2');
    expect(String(where().pricePerUnit.lte)).toBe('8');
  });

  it('reads page and page_size (snake_case)', async () => {
    const res = await request(app).get('/products').query({ page: '2', page_size: '15' });
    expect(res.body).toMatchObject({ page: 2, page_size: 15 });
    expect(query()).toMatchObject({ take: 15, skip: 15 });
  });

  it('ignores camelCase pageSize', async () => {
    const res = await request(app).get('/products').query({ pageSize: '15' });
    expect(res.body.page_size).toBe(20);
  });

  it.each([
    ['true', {}],
    ['1', {}],
    ['false', { isAvailable: true }],
    ['yes', { isAvailable: true }],
  ])('include_unavailable=%s', async (value, expected) => {
    await request(app).get('/products').query({ include_unavailable: value });
    expect(where()).toEqual(expected);
  });

  it('ignores a repeated parameter, which Express parses as an array', async () => {
    await request(app).get('/products?category=A&category=B');
    // Express parses repeats as an array; the handler only accepts strings.
    expect(where().category).toBeUndefined();
  });

  it('reads q as an alias for search (#1132)', async () => {
    await request(app).get('/products').query({ q: 'tomato' });
    expect(where().OR).toHaveLength(3);
  });

  it('reads price_min / price_max (#1132)', async () => {
    await request(app).get('/products').query({ price_min: '2', price_max: '8' });
    expect(String(where().pricePerUnit.gte)).toBe('2');
    expect(String(where().pricePerUnit.lte)).toBe('8');
  });

  it('reads categories (comma-separated) (#1132)', async () => {
    await request(app).get('/products').query({ categories: 'Vegetables,Fruits' });
    expect(where().category.in).toEqual(['Vegetables', 'Fruits']);
  });

  it('reads sort and returns appropriate orderBy (#1132)', async () => {
    await request(app).get('/products').query({ sort: 'price_asc' });
    expect(query().orderBy).toMatchObject({ pricePerUnit: 'asc' });
  });

  it('rejects invalid sort values with 400', async () => {
    const res = await request(app).get('/products').query({ sort: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Invalid sort value');
  });

  it('rejects distance sort without lat/lng with 400', async () => {
    const res = await request(app).get('/products').query({ sort: 'distance' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('lat and lng');
  });
});

describe('product write role matrix (#1145)', () => {
  describe('POST /products', () => {
    it('rejects anonymous callers with 401 and writes nothing', async () => {
      const res = await request(app).post('/products').send(validProduct);
      expect(res.status).toBe(401);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it.each(['FARMER', 'ADMIN'])('allows %s', async (role) => {
      const res = await request(app)
        .post('/products')
        .set('Authorization', bearer(role))
        .send(validProduct);
      expect(res.status).toBe(201);
      expect(prisma.product.create).toHaveBeenCalledTimes(1);
    });

    it('records the caller as the farmer, ignoring any farmer_wallet in the body', async () => {
      await request(app)
        .post('/products')
        .set('Authorization', bearer('FARMER', 'GCALLER'))
        .send({ ...validProduct, farmer_wallet: 'GSOMEONEELSE' });
      expect(vi.mocked(prisma.product.create).mock.calls[0]![0]!.data.farmerWallet).toBe('gcaller');
    });

    it('accepts XLM currency', async () => {
      const res = await request(app)
        .post('/products')
        .set('Authorization', bearer('FARMER'))
        .send({ ...validProduct, currency: 'XLM' });
      expect(res.status).toBe(201);
      expect(vi.mocked(prisma.product.create).mock.calls[0]![0]!.data.currency).toBe('XLM');
    });

    it('accepts USDC currency', async () => {
      const res = await request(app)
        .post('/products')
        .set('Authorization', bearer('FARMER'))
        .send({ ...validProduct, currency: 'USDC' });
      expect(res.status).toBe(201);
      expect(vi.mocked(prisma.product.create).mock.calls[0]![0]!.data.currency).toBe('USDC');
    });

    // Any authenticated wallet can list products today. #1133 adds requireRole.
    it.todo('rejects BUYER with 403 (#1133)');
  });

  describe.each([
    ['PATCH', (r: request.Test) => r.send({ name: 'Renamed' }), 200],
    ['DELETE', (r: request.Test) => r, 200],
  ] as const)('%s /products/:id', (method, withBody, okStatus) => {
    const call = (auth?: string) => {
      const r =
        method === 'PATCH'
          ? request(app).patch('/products/prod-1')
          : request(app).delete('/products/prod-1');
      return withBody(auth ? r.set('Authorization', auth) : r);
    };

    it('rejects anonymous callers with 401', async () => {
      expect((await call()).status).toBe(401);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('allows the owning farmer', async () => {
      expect((await call(bearer('FARMER'))).status).toBe(okStatus);
      expect(prisma.product.update).toHaveBeenCalledTimes(1);
    });

    it.each(['FARMER', 'BUYER', 'ADMIN'])('rejects a non-owning %s with 403', async (role) => {
      const res = await call(bearer(role, 'gintruder'));
      expect(res.status).toBe(403);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown product', async () => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
      expect((await call(bearer('FARMER'))).status).toBe(404);
    });
  });
});

describe('product write rate limiting (#1216)', () => {
  it('returns 429 as problem+json after the write limit is exceeded', async () => {
    process.env['ENABLE_TEST_RATE_LIMIT'] = 'true';
    try {
      for (let i = 0; i < 10; i += 1) {
        const res = await request(app)
          .post('/products')
          .set('Authorization', bearer('FARMER'))
          .send(validProduct);
        expect(res.status).toBe(201);
      }

      const res = await request(app)
        .post('/products')
        .set('Authorization', bearer('FARMER'))
        .send(validProduct);

      expect(res.status).toBe(429);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({ status: 429, title: 'Too Many Requests' });
    } finally {
      delete process.env['ENABLE_TEST_RATE_LIMIT'];
    }
  });
});
