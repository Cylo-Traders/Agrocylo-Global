import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createRateLimitMock,
  createWalletAuthMock,
} from '../test/helpers/middlewareMocks.js';

vi.mock('../db/client.js', () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
    },
  },
  connectDB: vi.fn(),
}));

vi.mock('../services/wsServer.js', () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
}));

vi.mock('../middleware/walletAuth.js', () => createWalletAuthMock());
vi.mock('../middleware/rateLimit.js', () => createRateLimitMock());

import app from '../app.js';
import { prisma } from '../db/client.js';
import { PriceIndexResponseSchema } from './analytics.js';

describe('Analytics API (Issue #1189)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/v1/analytics/price-index returns regional price data', async () => {
    (prisma.product.findMany as any).mockResolvedValue([
      {
        id: 'prod-1',
        name: 'White Maize',
        category: 'GRAINS',
        priceTokens: BigInt('45000000'), // 4.5 XLM
        campaign: { farmerAddress: 'GFARMER123456789' },
      },
    ]);

    const res = await request(app)
      .get('/api/v1/analytics/price-index')
      .expect(200);

    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('crop', 'White Maize');
    expect(res.body.data[0]).toHaveProperty('averagePrice', 4.5);
    expect(res.body.data[0].sampleCount).toBe(1);
    expect(() => PriceIndexResponseSchema.parse(res.body)).not.toThrow();
    expect(res.body.meta).toMatchObject({
      source: 'marketplace',
      currency: 'XLM',
      unit: 'XLM per product token',
    });
  });

  it('returns an empty dataset with no fabricated benchmarks when there are no products', async () => {
    (prisma.product.findMany as any).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/analytics/price-index')
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(() => PriceIndexResponseSchema.parse(res.body)).not.toThrow();
    expect(res.body.meta.computedAt).toBeTruthy();
  });

  it('GET /analytics/price-index without /api/v1 prefix also succeeds (no 404)', async () => {
    (prisma.product.findMany as any).mockResolvedValue([]);

    const res = await request(app).get('/analytics/price-index').expect(200);

    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('aggregates over full listing set (>100 listings) with accurate sampleCount and deterministic ordering (#1342)', async () => {
    // Generate 150 products (more than the previous 100 limit)
    const productList = Array.from({ length: 150 }, (_, i) => ({
      id: `prod-${i}`,
      name: 'Yellow Corn',
      category: 'GRAINS',
      priceTokens: BigInt('20000000'), // 2.0 XLM
      campaign: { farmerAddress: 'GFARMER_TEST' },
    }));

    (prisma.product.findMany as any).mockResolvedValue(productList);

    const res = await request(app)
      .get('/api/v1/analytics/price-index')
      .expect(200);

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      include: { campaign: true },
      orderBy: [{ id: 'asc' }],
    });

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].crop).toBe('Yellow Corn');
    expect(res.body.data[0].sampleCount).toBe(150); // Not capped at 100!
    expect(res.body.data[0].averagePrice).toBe(2);
    expect(() => PriceIndexResponseSchema.parse(res.body)).not.toThrow();
  });

  it('ensures group ordering and results are deterministic regardless of insertion order (#1342)', async () => {
    const listA = [
      {
        id: 'prod-1',
        name: 'Wheat',
        category: 'GRAINS',
        priceTokens: BigInt('10000000'),
        campaign: { farmerAddress: 'GFARMER_A' },
      },
      {
        id: 'prod-2',
        name: 'Barley',
        category: 'GRAINS',
        priceTokens: BigInt('30000000'),
        campaign: { farmerAddress: 'GFARMER_B' },
      },
    ];

    const listB = [listA[1], listA[0]]; // Reversed

    (prisma.product.findMany as any).mockResolvedValue(listA);
    const resA = await request(app).get('/api/v1/analytics/price-index').expect(200);

    (prisma.product.findMany as any).mockResolvedValue(listB);
    const resB = await request(app).get('/api/v1/analytics/price-index').expect(200);

    const normalize = (items: any[]) => items.map(({ computedAt, ...rest }) => rest);
    expect(normalize(resA.body.data)).toEqual(normalize(resB.body.data));
    expect(resA.body.data[0].crop).toBe('Barley');
    expect(resA.body.data[1].crop).toBe('Wheat');
  });
});
