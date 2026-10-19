import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createRateLimitMock } from './helpers/middlewareMocks.js';

const { mockCampaignFindMany, mockCampaignCount, mockUserFindUnique } = vi.hoisted(() => ({
  mockCampaignFindMany: vi.fn(),
  mockCampaignCount: vi.fn(),
  mockUserFindUnique: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    campaign: { findMany: mockCampaignFindMany, count: mockCampaignCount },
    user: { findUnique: mockUserFindUnique },
  },
  connectDB: vi.fn(),
}));

vi.mock('../services/wsServer.js', () => ({
  broadcast: vi.fn(),
  getWsClientCount: vi.fn(() => 0),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
}));

vi.mock('../middleware/rateLimit.js', () => createRateLimitMock());

import app from '../app.js';

/**
 * Express 4 does not forward rejected promises from async handlers; without
 * `asyncHandler` these requests hang until the client times out (Issue #1207).
 */
describe('async route handler rejections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('turns a rejecting Prisma call into a 500 problem+json response', async () => {
    mockCampaignFindMany.mockRejectedValue(new Error('connection reset'));
    mockCampaignCount.mockRejectedValue(new Error('connection reset'));

    const res = await request(app).get('/api/v1/campaigns').timeout(2000);

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 500, title: 'Internal Server Error' });
    expect(JSON.stringify(res.body)).not.toContain('connection reset');
  });
});
