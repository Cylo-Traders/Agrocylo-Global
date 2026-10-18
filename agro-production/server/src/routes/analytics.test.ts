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

    const res = await request(app).get('/api/v1/analytics/price-index').expect(200);

    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('crop', 'White Maize');
    expect(res.body.data[0]).toHaveProperty('averagePrice', 4.5);
  });

  it('GET /analytics/price-index without /api/v1 prefix also succeeds (no 404)', async () => {
    (prisma.product.findMany as any).mockResolvedValue([]);

    const res = await request(app).get('/analytics/price-index').expect(200);

    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    // Returns default benchmarks when DB has no products
    expect(res.body.data.length).toBe(4);
  });
});
