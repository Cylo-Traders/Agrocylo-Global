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
import {
  PRICE_INDEX_PAGE_SIZE,
  PriceIndexResponseSchema,
} from './analytics.js';

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

  describe('full listing set aggregation (Issue #1342)', () => {
    type Listing = {
      id: string;
      name: string;
      category: string;
      priceTokens: bigint;
      campaign: { farmerAddress: string } | null;
    };

    function makeListings(count: number): Listing[] {
      return Array.from({ length: count }, (_, i) => ({
        id: `prod-${String(i).padStart(5, '0')}`,
        name: i % 2 === 0 ? 'Maize' : 'Cassava',
        category: 'GRAINS',
        // 1..count XLM in stroops
        priceTokens: BigInt(i + 1) * 10_000_000n,
        campaign: i % 3 === 0 ? { farmerAddress: 'GFARMERABCDEF' } : null,
      }));
    }

    /**
     * Emulates Prisma keyset pagination over an id-ordered table, regardless
     * of the order rows were stored in.
     */
    function mockTable(rows: Listing[]) {
      const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
      (prisma.product.findMany as any).mockImplementation(
        async (args: {
          take: number;
          skip?: number;
          cursor?: { id: string };
          orderBy: unknown;
        }) => {
          expect(args.orderBy).toEqual({ id: 'asc' });
          let start = 0;
          if (args.cursor) {
            start =
              sorted.findIndex((r) => r.id === args.cursor!.id) +
              (args.skip ?? 0);
          }
          return sorted.slice(start, start + args.take);
        },
      );
    }

    function shuffle<T>(arr: T[], seed: number): T[] {
      const out = [...arr];
      let s = seed;
      for (let i = out.length - 1; i > 0; i--) {
        s = (s * 9301 + 49297) % 233280;
        const j = Math.floor((s / 233280) * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }

    it('aggregates more than one page of listings (> 100)', async () => {
      const count = PRICE_INDEX_PAGE_SIZE * 2 + 37;
      const listings = makeListings(count);
      mockTable(listings);

      const res = await request(app)
        .get('/api/v1/analytics/price-index')
        .expect(200);

      expect(() => PriceIndexResponseSchema.parse(res.body)).not.toThrow();
      expect(res.body.meta.totalListings).toBe(count);
      expect(res.body.meta.samplingPolicy).toBe('all active listings');
      const summed = res.body.data.reduce(
        (acc: number, e: { sampleCount: number }) => acc + e.sampleCount,
        0,
      );
      expect(summed).toBe(count);
      // 3 pages: two full, one partial
      expect(prisma.product.findMany).toHaveBeenCalledTimes(3);

      // Verify one group's average against a direct computation.
      const maizeGlobal = listings.filter(
        (l) => l.name === 'Maize' && l.campaign === null,
      );
      const expectedAvg =
        Number(
          maizeGlobal.reduce((a, l) => a + l.priceTokens, 0n) /
            BigInt(maizeGlobal.length),
        ) / 10_000_000;
      const entry = res.body.data.find(
        (e: { crop: string; region: string }) =>
          e.crop === 'Maize' && e.region === 'Global',
      );
      expect(entry.sampleCount).toBe(maizeGlobal.length);
      expect(entry.averagePrice).toBeCloseTo(expectedAvg, 4);
    });

    it('returns identical results regardless of insertion order', async () => {
      const listings = makeListings(250);

      mockTable(listings);
      const a = await request(app).get('/api/v1/analytics/price-index');
      mockTable(shuffle(listings, 42));
      const b = await request(app).get('/api/v1/analytics/price-index');
      mockTable([...listings].reverse());
      const c = await request(app).get('/api/v1/analytics/price-index');

      const strip = (body: { data: Array<Record<string, unknown>> }) =>
        body.data.map(({ computedAt: _c, ...rest }) => rest);
      expect(strip(b.body)).toEqual(strip(a.body));
      expect(strip(c.body)).toEqual(strip(a.body));
      expect(a.body.meta.totalListings).toBe(250);
    });
  });
});
