import request from 'supertest';
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/database.js', () => ({
  prisma: {
    buyerDemand: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
    profile: { findMany: vi.fn() },
  },
}));

const { prisma } = await import('../config/database.js');
const { default: marketRoutes } = await import('./marketRoutes.js');
const app = express();
app.use(marketRoutes);

const now = new Date();
const row = (o: object) => ({
  id: 'd1', buyerWallet: 'gb1', cropName: 'Maize', quantityWanted: '100', unit: 'kg',
  maxPricePerUnit: '2', currency: 'XLM', region: 'Lagos', neededBy: null, createdAt: now, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.buyerDemand.findMany).mockResolvedValue([
    row({}), row({ id: 'd2', buyerWallet: 'gb2', region: 'Abuja', quantityWanted: '50' }),
  ] as any);
  vi.mocked(prisma.location.findMany).mockResolvedValue([
    { walletAddress: 'gb1', lat: 6.5, lng: 3.4 }, { walletAddress: 'gb2', lat: 9, lng: 7.4 },
  ] as any);
  vi.mocked(prisma.profile.findMany).mockResolvedValue([{ walletAddress: 'gb1', name: 'Ada' }] as any);
});

describe('/market/* (#1134)', () => {
  it('GET /market/heatmap aggregates demand by region with 0..1 intensity', async () => {
    const res = await request(app).get('/market/heatmap');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { coordinates: [6.5, 3.4], intensity: 1, label: 'Lagos' },
      { coordinates: [9, 7.4], intensity: 0.5, label: 'Abuja' },
    ]);
  });

  it('GET /market/buyer-intents matches the BuyerIntent shape', async () => {
    const res = await request(app).get('/market/buyer-intents');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: 'd1', buyer_name: 'Ada', product_name: 'Maize', quantity: '100', unit: 'kg',
      location: { region: 'Lagos', coordinates: [6.5, 3.4] },
    });
    expect(res.body[1].buyer_name).toBe('Buyer');
  });

  it('GET /market/trend returns one point per day', async () => {
    const res = await request(app).get('/market/trend?days=7');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
    expect(res.body.at(-1)).toEqual({ date: now.toISOString().slice(0, 10), volume: 150 });
  });

  it('GET /market/demand returns DemandData', async () => {
    const res = await request(app).get('/market/demand');
    expect(res.status).toBe(200);
    expect(res.body.volume.total_volume).toBe('150');
    expect(res.body.intents).toHaveLength(2);
    expect(res.body.heatMap).toHaveLength(2);
    expect(res.body.trend).toHaveLength(30);
  });
});
