import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
vi.mock('@prisma/client', () => {
  const mPrisma = {
    campaign: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    investment: {
      findMany: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
    },
  };
  return { PrismaClient: vi.fn(() => mPrisma) };
});

const prisma = new PrismaClient() as any;

describe('Campaign API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/campaigns should return paginated campaigns', async () => {
    const mockCampaigns = [
      { id: '1', farmerAddress: 'addr1', targetAmount: '1000', status: 'FUNDING' },
    ];
    prisma.campaign.findMany.mockResolvedValue(mockCampaigns);
    prisma.campaign.count.mockResolvedValue(1);

    const res = await request(app).get('/api/campaigns');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it('GET /api/campaigns/:id should return a specific campaign', async () => {
    const mockCampaign = { id: '1', farmerAddress: 'addr1', investments: [] };
    prisma.campaign.findUnique.mockResolvedValue(mockCampaign);

    const res = await request(app).get('/api/campaigns/1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('1');
  });

  it('GET /api/analytics/price-history should return analytics', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'o1', amount: '100', status: 'COMPLETED', product: { name: 'tomato', pricePerUnit: '10' } }
    ]);

    const res = await request(app).get('/api/analytics/price-history?product=tomato');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('avg_price');
    expect(res.body.avg_price).toBe(10);
  });

  it('GET /api/campaigns/:id should return 404 if not found', async () => {
    prisma.campaign.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/campaigns/999');

    expect(res.status).toBe(404);
  });
});
