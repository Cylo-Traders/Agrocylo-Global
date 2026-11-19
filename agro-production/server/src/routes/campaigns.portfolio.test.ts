import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createRateLimitMock,
  createWalletAuthMock,
} from '../test/helpers/middlewareMocks.js';

const {
  mockInvestmentFindMany,
  mockTransactionFindMany,
  TEST_WALLET,
} = vi.hoisted(() => ({
  mockInvestmentFindMany: vi.fn(),
  mockTransactionFindMany: vi.fn(),
  TEST_WALLET: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAA',
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    investment: {
      findMany: mockInvestmentFindMany,
    },
    transaction: {
      findMany: mockTransactionFindMany,
    },
  },
  connectDB: vi.fn(),
}));

vi.mock('../services/wsServer.js', () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
}));

vi.mock('../middleware/walletAuth.js', () => ({
  requireWallet: (req: any, _res: any, next: any) => {
    req.walletAddress = TEST_WALLET;
    next();
  },
}));
vi.mock('../middleware/rateLimit.js', () => createRateLimitMock());

import app from '../app.js';
import { InvestorPortfolioSummarySchema } from '../schemas/responses.js';

const MOCK_UUID_1 = '11111111-1111-4111-8111-111111111111';
const MOCK_UUID_2 = '22222222-2222-4222-8222-222222222222';
const MOCK_STELLAR_ADDR = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describe('GET /api/v1/investor/portfolio (Issue #1343)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns totalReturned: "0" when no claims have been made', async () => {
    mockInvestmentFindMany.mockResolvedValue([
      {
        id: MOCK_UUID_1,
        campaignId: MOCK_UUID_2,
        investorAddress: TEST_WALLET,
        amount: '100000000', // 10 XLM
        ledger: 100,
        txHash: 'tx-1',
        createdAt: new Date('2026-11-19T10:00:00Z'),
        campaign: {
          id: MOCK_UUID_2,
          onChainId: '1',
          farmerAddress: MOCK_STELLAR_ADDR,
          tokenAddress: MOCK_STELLAR_ADDR,
          targetAmount: '500000000',
          totalRaised: '100000000',
          totalRevenue: '0',
          status: 'FUNDING',
          deadline: new Date('2026-12-01T00:00:00Z'),
        },
      },
    ]);
    mockTransactionFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/investor/portfolio').expect(200);

    expect(res.body.investorAddress).toBe(TEST_WALLET);
    expect(res.body.totalInvested).toBe('100000000');
    expect(res.body.totalReturned).toBe('0');
    expect(res.body.positions).toHaveLength(1);
    expect(() => InvestorPortfolioSummarySchema.parse(res.body)).not.toThrow();
  });

  it('aggregates multiple claims and preserves exact 128-bit integer arithmetic without precision loss', async () => {
    mockInvestmentFindMany.mockResolvedValue([
      {
        id: MOCK_UUID_1,
        campaignId: MOCK_UUID_2,
        investorAddress: TEST_WALLET,
        amount: '10000000000000000000',
        ledger: 100,
        txHash: 'tx-1',
        createdAt: new Date('2026-11-19T10:00:00Z'),
        campaign: {
          id: MOCK_UUID_2,
          onChainId: '1',
          farmerAddress: MOCK_STELLAR_ADDR,
          tokenAddress: MOCK_STELLAR_ADDR,
          targetAmount: '20000000000000000000',
          totalRaised: '10000000000000000000',
          totalRevenue: '25000000000000000000',
          status: 'HARVESTED',
          deadline: new Date('2026-12-01T00:00:00Z'),
        },
      },
    ]);

    // 3 separate claims: including values > 2^53 (which would overflow standard JS numbers)
    mockTransactionFindMany.mockResolvedValue([
      {
        id: 'tx-claim-1',
        walletAddress: TEST_WALLET,
        eventType: 'campaign.claimed',
        payload: { payout: '9007199254740993' }, // 2^53 + 1
      },
      {
        id: 'tx-claim-2',
        walletAddress: TEST_WALLET,
        eventType: 'campaign.claimed',
        payload: { payout: '10000000000000000000' }, // 10^19
      },
      {
        id: 'tx-claim-3',
        walletAddress: TEST_WALLET,
        eventType: 'campaign.claimed',
        payload: { payout: '500' },
      },
    ]);

    const res = await request(app).get('/api/v1/investor/portfolio').expect(200);

    expect(mockTransactionFindMany).toHaveBeenCalledWith({
      where: {
        walletAddress: TEST_WALLET,
        eventType: 'campaign.claimed',
      },
    });

    const expectedTotal =
      BigInt('9007199254740993') +
      BigInt('10000000000000000000') +
      BigInt('500');

    expect(res.body.totalReturned).toBe(expectedTotal.toString());
    expect(res.body.totalReturned).toBe('10009007199254741493');
    expect(() => InvestorPortfolioSummarySchema.parse(res.body)).not.toThrow();
  });
});
