import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createRateLimitMock,
  createWalletAuthMock,
} from '../test/helpers/middlewareMocks.js';

// Mock dependencies before importing the router
vi.mock('../db/client.js', () => ({
  prisma: {
    dispute: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    disputeEvidence: {
      create: vi.fn(),
    },
    disputeAuditEntry: {
      create: vi.fn(),
    },
    campaign: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));

vi.mock('../services/wsServer.js', () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
}));

vi.mock('../middleware/walletAuth.js', () => createWalletAuthMock());

// The mocked module has to expose every limiter the module graph imports.
// `routes/disputes.ts` imports `writeLimiter`, and `routes/auth.ts` imports
// `authLimiter` at module scope, so a partial mock broke collection of this
// whole suite with a zero-test file (issue #1063).
vi.mock('../middleware/rateLimit.js', () => createRateLimitMock());

import disputesRouter from './disputes.js';
import { prisma } from '../db/client.js';
import { globalErrorHandler } from '../middleware/errors.js';

/**
 * `disputes.ts` is not mounted on the top-level `app.ts` graph, so this suite
 * exercises the router on its own instance. Mounting the whole app here made
 * every request fall through to `adminReconciliation`'s `requireRole("ADMIN")`
 * and answered 403 before the disputes router was ever reached.
 */
function createDisputesApp() {
  const testApp = express();
  testApp.use(express.json());
  testApp.use('/api/v1', disputesRouter);
  testApp.use(globalErrorHandler);
  return testApp;
}

const app = createDisputesApp();

// Test constants
const INITIATOR = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const RESPONDENT = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ADMIN = 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const CAMPAIGN_UUID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ORDER_UUID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const DISPUTE_UUID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const TX_HASH = '0x1234567890abcdef';
const NOW = new Date().toISOString();

const mockDispute = {
  id: DISPUTE_UUID,
  campaignId: CAMPAIGN_UUID,
  orderId: ORDER_UUID,
  initiatorAddress: INITIATOR,
  respondentAddress: RESPONDENT,
  status: 'Open' as const,
  resolutionOutcome: null,
  resolutionNotes: null,
  transactionHash: TX_HASH,
  ledgerSequence: 100,
  createdAt: NOW,
  updatedAt: NOW,
};

const mockEvidence = {
  id: 'evidence-uuid-1',
  submitterAddress: INITIATOR,
  submittedAt: NOW,
};

describe('Disputes API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/disputes', () => {
    it('should return empty list when no disputes exist', async () => {
      (prisma.dispute.findMany as any).mockResolvedValue([]);
      (prisma.dispute.count as any).mockResolvedValue(0);
      (prisma.user.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/disputes')
        .set('x-wallet-address', INITIATOR)
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('should return paginated disputes', async () => {
      (prisma.dispute.findMany as any).mockResolvedValue([mockDispute]);
      (prisma.dispute.count as any).mockResolvedValue(1);
      (prisma.user.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/disputes?page=1&limit=20')
        .set('x-wallet-address', INITIATOR)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(20);
    });

    it('should filter disputes by campaignId', async () => {
      (prisma.dispute.findMany as any).mockResolvedValue([mockDispute]);
      (prisma.dispute.count as any).mockResolvedValue(1);
      (prisma.user.findUnique as any).mockResolvedValue(null);

      await request(app)
        .get(`/api/v1/disputes?campaignId=${CAMPAIGN_UUID}`)
        .set('x-wallet-address', INITIATOR)
        .expect(200);

      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            campaignId: CAMPAIGN_UUID,
          }),
        }),
      );
    });

    it('should only show participant disputes to non-admin users', async () => {
      (prisma.dispute.findMany as any).mockResolvedValue([mockDispute]);
      (prisma.dispute.count as any).mockResolvedValue(1);
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'BUYER' });

      await request(app)
        .get('/api/v1/disputes')
        .set('x-wallet-address', INITIATOR)
        .expect(200);

      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { initiatorAddress: INITIATOR },
              { respondentAddress: INITIATOR },
            ],
          }),
        }),
      );
    });

    it('should show all disputes to admin users', async () => {
      (prisma.dispute.findMany as any).mockResolvedValue([mockDispute]);
      (prisma.dispute.count as any).mockResolvedValue(1);
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'ADMIN' });

      await request(app)
        .get('/api/v1/disputes')
        .set('x-wallet-address', ADMIN)
        .expect(200);

      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });
  });

  describe('GET /api/v1/disputes/:id', () => {
    it('should return dispute detail with evidence', async () => {
      (prisma.dispute.findUnique as any).mockResolvedValue({
        ...mockDispute,
        evidence: [mockEvidence],
      });
      (prisma.user.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/disputes/${DISPUTE_UUID}`)
        .set('x-wallet-address', INITIATOR)
        .expect(200);

      expect(res.body.evidence).toEqual([mockEvidence]);
      expect(res.body.status).toBe('Open');
    });

    it('should return 404 for unknown dispute', async () => {
      const unknownUUID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';
      (prisma.dispute.findUnique as any).mockResolvedValue(null);

      await request(app)
        .get(`/api/v1/disputes/${unknownUUID}`)
        .set('x-wallet-address', INITIATOR)
        .expect(404);
    });

    it('should allow participants to view dispute', async () => {
      (prisma.dispute.findUnique as any).mockResolvedValue({
        ...mockDispute,
        evidence: [],
      });
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'BUYER' });

      await request(app)
        .get(`/api/v1/disputes/${DISPUTE_UUID}`)
        .set('x-wallet-address', INITIATOR)
        .expect(200);
    });

    it('should forbid non-participants from viewing dispute (403)', async () => {
      (prisma.dispute.findUnique as any).mockResolvedValue({
        ...mockDispute,
        evidence: [],
      });
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'BUYER' });

      const otherAddress =
        'GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
      const res = await request(app)
        .get(`/api/v1/disputes/${DISPUTE_UUID}`)
        .set('x-wallet-address', otherAddress)
        .expect(403);

      expect(res.body.status).toBe(403);
    });

    it('should allow admin to view any dispute', async () => {
      (prisma.dispute.findUnique as any).mockResolvedValue({
        ...mockDispute,
        evidence: [],
      });
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'ADMIN' });

      await request(app)
        .get(`/api/v1/disputes/${DISPUTE_UUID}`)
        .set('x-wallet-address', ADMIN)
        .expect(200);
    });
  });

  describe('POST /api/v1/disputes/:id/evidence', () => {
    it('should require x-wallet-address header', async () => {
      await request(app)
        .post(`/api/v1/disputes/${DISPUTE_UUID}/evidence`)
        .send({
          evidenceUrl: 'https://example.com/evidence.pdf',
          evidenceHash: 'hash123',
        })
        .expect(401);
    });

    it('should submit evidence by participant', async () => {
      (prisma.dispute.findUnique as any).mockResolvedValue(mockDispute);
      const evidenceResponse = {
        id: 'evidence-uuid-1',
        submitterAddress: INITIATOR,
        submittedAt: NOW,
      };
      (prisma.disputeEvidence.create as any).mockResolvedValue(
        evidenceResponse,
      );

      const res = await request(app)
        .post(`/api/v1/disputes/${DISPUTE_UUID}/evidence`)
        .set('x-wallet-address', INITIATOR)
        .send({
          evidenceUrl: 'https://example.com/evidence.pdf',
          evidenceHash: 'hash123',
        })
        .expect(201);

      expect(res.body.submitterAddress).toBe(INITIATOR);
      expect(prisma.disputeEvidence.create).toHaveBeenCalled();
    });

    it('should forbid non-participants from submitting evidence (403)', async () => {
      (prisma.dispute.findUnique as any).mockResolvedValue(mockDispute);

      const otherAddress =
        'GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
      await request(app)
        .post(`/api/v1/disputes/${DISPUTE_UUID}/evidence`)
        .set('x-wallet-address', otherAddress)
        .send({
          evidenceUrl: 'https://example.com/evidence.pdf',
          evidenceHash: 'hash123',
        })
        .expect(403);
    });

    it('should forbid evidence submission to closed disputes', async () => {
      (prisma.dispute.findUnique as any).mockResolvedValue({
        ...mockDispute,
        status: 'Resolved',
      });

      await request(app)
        .post(`/api/v1/disputes/${DISPUTE_UUID}/evidence`)
        .set('x-wallet-address', INITIATOR)
        .send({
          evidenceUrl: 'https://example.com/evidence.pdf',
          evidenceHash: 'hash123',
        })
        .expect(409);
    });

    it('should return 404 for unknown dispute', async () => {
      const unknownUUID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';
      (prisma.dispute.findUnique as any).mockResolvedValue(null);

      await request(app)
        .post(`/api/v1/disputes/${unknownUUID}/evidence`)
        .set('x-wallet-address', INITIATOR)
        .send({
          evidenceUrl: 'https://example.com/evidence.pdf',
          evidenceHash: 'hash123',
        })
        .expect(404);
    });

    it('should validate evidence URL format', async () => {
      (prisma.dispute.findUnique as any).mockResolvedValue(mockDispute);

      await request(app)
        .post(`/api/v1/disputes/${DISPUTE_UUID}/evidence`)
        .set('x-wallet-address', INITIATOR)
        .send({
          evidenceUrl: 'not-a-url',
          evidenceHash: 'hash123',
        })
        .expect(400);
    });
  });

  describe('PATCH /api/v1/disputes/:id/resolve', () => {
    it('should require x-wallet-address header', async () => {
      await request(app)
        .patch(`/api/v1/disputes/${DISPUTE_UUID}/resolve`)
        .send({
          resolutionOutcome: 'upheld',
          resolutionNotes: 'Initiator provided sufficient evidence',
        })
        .expect(401);
    });

    it('should forbid non-admin users from resolving (403)', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'BUYER' });

      await request(app)
        .patch(`/api/v1/disputes/${DISPUTE_UUID}/resolve`)
        .set('x-wallet-address', INITIATOR)
        .send({
          resolutionOutcome: 'upheld',
          resolutionNotes: 'Initiator provided sufficient evidence',
        })
        .expect(403);
    });

    it('should allow admin to resolve dispute', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'ADMIN' });
      (prisma.dispute.findUnique as any).mockResolvedValue(mockDispute);
      (prisma.dispute.update as any).mockResolvedValue({
        ...mockDispute,
        status: 'Resolved',
        resolutionOutcome: 'upheld',
      });
      (prisma.disputeAuditEntry.create as any).mockResolvedValue({});

      const res = await request(app)
        .patch(`/api/v1/disputes/${DISPUTE_UUID}/resolve`)
        .set('x-wallet-address', ADMIN)
        .send({
          resolutionOutcome: 'upheld',
          resolutionNotes: 'Initiator provided sufficient evidence',
        })
        .expect(200);

      expect(res.body.status).toBe('Resolved');
      expect(prisma.dispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'Resolved',
            resolutionOutcome: 'upheld',
          }),
        }),
      );
    });

    it('should return 404 for unknown dispute', async () => {
      const unknownUUID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'ADMIN' });
      (prisma.dispute.findUnique as any).mockResolvedValue(null);

      await request(app)
        .patch(`/api/v1/disputes/${unknownUUID}/resolve`)
        .set('x-wallet-address', ADMIN)
        .send({
          resolutionOutcome: 'upheld',
        })
        .expect(404);
    });

    it('should forbid resolving already-resolved disputes', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'ADMIN' });
      (prisma.dispute.findUnique as any).mockResolvedValue({
        ...mockDispute,
        status: 'Resolved',
      });

      await request(app)
        .patch(`/api/v1/disputes/${DISPUTE_UUID}/resolve`)
        .set('x-wallet-address', ADMIN)
        .send({
          resolutionOutcome: 'upheld',
        })
        .expect(409);
    });

    it('should create audit entry on resolution', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ role: 'ADMIN' });
      (prisma.dispute.findUnique as any).mockResolvedValue(mockDispute);
      (prisma.dispute.update as any).mockResolvedValue({
        ...mockDispute,
        status: 'Resolved',
      });
      (prisma.disputeAuditEntry.create as any).mockResolvedValue({});

      await request(app)
        .patch(`/api/v1/disputes/${DISPUTE_UUID}/resolve`)
        .set('x-wallet-address', ADMIN)
        .send({
          resolutionOutcome: 'upheld',
        })
        .expect(200);

      expect(prisma.disputeAuditEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            disputeId: DISPUTE_UUID,
            action: 'resolved',
            actorAddress: ADMIN,
          }),
        }),
      );
    });
  });
});
