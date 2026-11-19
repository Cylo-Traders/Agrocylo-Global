import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createRateLimitMock,
  createWalletAuthMock,
} from '../test/helpers/middlewareMocks.js';

const { mockGetIndexerReadiness } = vi.hoisted(() => ({
  mockGetIndexerReadiness: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  prisma: {},
  connectDB: vi.fn(),
}));

vi.mock('../services/wsServer.js', () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
}));

vi.mock('../middleware/walletAuth.js', () => createWalletAuthMock());
vi.mock('../middleware/rateLimit.js', () => createRateLimitMock());

vi.mock('../services/indexerReadinessService.js', () => ({
  getIndexerReadiness: mockGetIndexerReadiness,
}));

vi.mock('../config/index.js', () => ({
  config: {
    contractId: 'DEFAULT_CONTRACT_ID',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    nodeEnv: 'test',
  },
}));

import app from '../app.js';

describe('GET /indexer/readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses default contractId when query parameter is not provided', async () => {
    const mockTime = new Date('2026-11-19T14:00:00.000Z');
    mockGetIndexerReadiness.mockResolvedValue({
      isReady: true,
      lastProcessedLedger: 500,
      lastProcessedTime: mockTime,
      freshnessSeconds: 15,
      isFresh: true,
      maxLagSeconds: 300,
      cursor: { ledger: 500, eventIndex: 1 },
    });

    const res = await request(app).get('/api/v1/indexer/readiness');

    expect(res.status).toBe(200);
    expect(mockGetIndexerReadiness).toHaveBeenCalledWith('DEFAULT_CONTRACT_ID', 300);
    expect(res.body).toEqual({
      isReady: true,
      lastProcessedLedger: 500,
      lastProcessedTime: mockTime.toISOString(),
      freshnessSeconds: 15,
      isFresh: true,
      maxLagSeconds: 300,
      cursor: { ledger: 500, eventIndex: 1 },
    });
  });

  it('accepts and passes custom contractId and maxLagSeconds query parameters', async () => {
    mockGetIndexerReadiness.mockResolvedValue({
      isReady: false,
      lastProcessedLedger: 0,
      lastProcessedTime: null,
      freshnessSeconds: -1,
      isFresh: false,
      maxLagSeconds: 120,
      cursor: null,
    });

    const res = await request(app)
      .get('/api/v1/indexer/readiness')
      .query({ contractId: 'CUSTOM_CONTRACT_99', maxLagSeconds: '120' });

    expect(res.status).toBe(200);
    expect(mockGetIndexerReadiness).toHaveBeenCalledWith('CUSTOM_CONTRACT_99', 120);
    expect(res.body.isFresh).toBe(false);
    expect(res.body.maxLagSeconds).toBe(120);
  });
});
