import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createRateLimitMock,
  createWalletAuthMock,
} from '../test/helpers/middlewareMocks.js';

vi.mock('../db/client.js', () => ({
  prisma: {
    investment: { findMany: vi.fn() },
    campaignClaim: { findMany: vi.fn() },
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
import { InvestorPortfolioSummarySchema } from '../schemas/responses.js';

const WALLET = 'G' + 'A'.repeat(55);
const CAMPAIGN_1 = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_2 = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_3 = '33333333-3333-4333-8333-333333333333';

function investment(id: string, campaignId: string, amount: string) {
  return {
    id,
    campaignId,
    investorAddress: WALLET,
    amount,
    ledger: 100,
    txHash: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function claim(
  campaignId: string,
  onChainId: string,
  payoutAmount: string,
  ledger: number,
) {
  return {
    id: `claim-${campaignId}`,
    campaignId,
    investorAddress: WALLET,
    payoutAmount,
    ledger,
    eventIndex: 0,
    txHash: 'c'.repeat(64),
    createdAt: new Date('2026-02-01T00:00:00Z'),
    campaign: { onChainId },
  };
}

describe('GET /investor/portfolio — direct campaign claims (Issue #1343)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports "0" returned when no position has been claimed', async () => {
    (prisma.investment.findMany as any).mockResolvedValue([
      investment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CAMPAIGN_1, '5000'),
    ]);
    (prisma.campaignClaim.findMany as any).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/investor/portfolio')
      .set('x-wallet-address', WALLET)
      .expect(200);

    expect(res.body.totalReturned).toBe('0');
    expect(res.body.claims).toEqual([]);
    expect(res.body.returnsSource).toBe('campaign_claims');
    expect(() => InvestorPortfolioSummarySchema.parse(res.body)).not.toThrow();
  });

  it('sums multiple claims with exact integer arithmetic, scoped to the wallet', async () => {
    // Values beyond Number.MAX_SAFE_INTEGER must not lose precision.
    const big1 = '9007199254740993'; // 2^53 + 1
    const big2 = '170141183460469231731687303715884105727'; // i128::MAX
    const small = '1';
    (prisma.investment.findMany as any).mockResolvedValue([
      investment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CAMPAIGN_1, '10'),
      investment('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', CAMPAIGN_2, '20'),
      investment('cccccccc-cccc-4ccc-8ccc-cccccccccccc', CAMPAIGN_3, '30'),
    ]);
    (prisma.campaignClaim.findMany as any).mockResolvedValue([
      claim(CAMPAIGN_1, '1', big1, 300),
      claim(CAMPAIGN_2, '2', big2, 200),
      claim(CAMPAIGN_3, '3', small, 100),
    ]);

    const res = await request(app)
      .get('/api/v1/investor/portfolio')
      .set('x-wallet-address', WALLET)
      .expect(200);

    const expected = (BigInt(big1) + BigInt(big2) + BigInt(small)).toString();
    expect(res.body.totalReturned).toBe(expected);
    expect(res.body.totalInvested).toBe('60');
    expect(res.body.claims).toHaveLength(3);
    expect(res.body.claims[1]).toMatchObject({
      campaignId: CAMPAIGN_2,
      campaignOnChainId: '2',
      payoutAmount: big2,
      ledger: 200,
    });
    expect(() => InvestorPortfolioSummarySchema.parse(res.body)).not.toThrow();

    expect(prisma.campaignClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { investorAddress: WALLET } }),
    );
  });

  it('leaves unclaimed positions out of the returned total', async () => {
    (prisma.investment.findMany as any).mockResolvedValue([
      investment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CAMPAIGN_1, '100'),
      investment('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', CAMPAIGN_2, '100'),
    ]);
    (prisma.campaignClaim.findMany as any).mockResolvedValue([
      claim(CAMPAIGN_1, '1', '150', 100),
    ]);

    const res = await request(app)
      .get('/api/v1/investor/portfolio')
      .set('x-wallet-address', WALLET)
      .expect(200);

    expect(res.body.totalReturned).toBe('150');
    expect(
      res.body.claims.map((c: { campaignId: string }) => c.campaignId),
    ).toEqual([CAMPAIGN_1]);
  });
});
