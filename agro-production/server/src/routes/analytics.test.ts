import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createRateLimitMock, createWalletAuthMock } from '../test/helpers/middlewareMocks.js';

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

describe('Analytics Price Index API Contract (Issue #1049, #1258)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/v1/analytics/price-index returns computed marketplace price data with documented schema metadata', async () => {
    (prisma.product.findMany as any).mockResolvedValue([
      {
        id: 'prod-1',
        name: 'White Maize',
        category: 'GRAINS',
        priceTokens: BigInt('45000000'), // 4.5 XLM
        campaign: { farmerAddress: 'GFARMER123456789' },
      },
      {
        id: 'prod-2',
        name: 'White Maize',
        category: 'GRAINS',
        priceTokens: BigInt('55000000'), // 5.5 XLM
        campaign: { farmerAddress: 'GFARMER123456789' },
      },
    ]);

    const res = await request(app).get('/api/v1/analytics/price-index').expect(200);

    const parsed = PriceIndexResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      crop: 'White Maize',
      region: 'Region-GFARME',
      averagePrice: 5,
      currency: 'XLM',
      unit: 'XLM_PER_UNIT',
      sampleCount: 2,
      sampleSemantics: 'active_marketplace_listings',
      regionSource: 'campaign_farmer_wallet_prefix',
    });
    expect(res.body.meta).toMatchObject({
      currency: 'XLM',
      unit: 'XLM_PER_UNIT',
      priceScale: 'stroops_1e7_to_xlm',
      sampleSemantics: 'active_marketplace_listings',
      regionSource: 'campaign_farmer_wallet_prefix',
      source: 'marketplace_computed',
      staleAfterSeconds: 3600,
    });
  });

  it('returns an empty dataset (never fabricated benchmark rows or sample counts) when no active products exist', async () => {
    (prisma.product.findMany as any).mockResolvedValue([]);

    const res = await request(app).get('/api/v1/analytics/price-index').expect(200);

    const parsed = PriceIndexResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.source).toBe('marketplace_computed');
    expect(typeof res.body.meta.computedAt).toBe('string');
  });
});
