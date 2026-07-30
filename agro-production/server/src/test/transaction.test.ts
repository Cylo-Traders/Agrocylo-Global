import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const { mockVerifySession } = vi.hoisted(() => ({
  mockVerifySession: vi.fn(),
}));

vi.mock('../services/walletAuthService.js', () => ({
  verifySession: mockVerifySession,
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../services/wsServer.js', () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
  drainWebSocketServer: vi.fn(),
  getWsClientCount: vi.fn(() => 0),
}));

vi.mock('../services/sorobanRpc.js', () => ({

  server: {
    getLatestLedger: vi.fn().mockResolvedValue({ sequence: 12345 }),
  },
}));

vi.mock('../events/watcher.js', () => ({
  startProductionWatcher: vi.fn().mockResolvedValue(null),
}));

vi.mock('../config/database.js', () => ({
  default: { end: vi.fn(), query: vi.fn() },
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    transaction: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    eventCursor: {
      findFirst: vi.fn(),
    },
    campaign: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    investment: { findMany: vi.fn(), create: vi.fn() },
    order: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { upsert: vi.fn(), findUnique: vi.fn() },
    dispute: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
  isPrismaHealthy: vi.fn(),
}));

import app from '../app.js';
import { prisma } from '../db/client.js';
import { broadcast } from '../services/wsServer.js';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_WALLET = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const TX_HASH = 'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890';
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    txHash: TX_HASH,
    walletAddress: WALLET,
    status: 'awaiting_signature',
    eventType: 'transaction.submitted',
    campaignId: null,
    ledger: 0,
    eventIndex: 0,
    payload: {},
    processedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('Transaction Status & Reconciliation API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifySession.mockResolvedValue({
      walletAddress: WALLET,
      sessionToken: 'test-session',
    });
  });

  describe('POST /api/v1/transactions', () => {
    it('creates a transaction intent with awaiting_signature status', async () => {
      (prisma.transaction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.transaction.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx());

      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', 'Bearer test-session')
        .send({
          requestId: REQUEST_ID,
          txHash: TX_HASH,
          walletAddress: WALLET,
          eventType: 'campaign.invested',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('awaiting_signature');
      expect(res.body.requestId).toBe(REQUEST_ID);
      expect(res.body.txHash).toBe(TX_HASH);
      expect(broadcast).toHaveBeenCalledWith('transaction.status', expect.objectContaining({
        status: 'awaiting_signature',
        walletAddress: WALLET,
      }));
    });

    it('returns existing transaction on duplicate requestId (idempotent)', async () => {
      (prisma.transaction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTx({ status: 'confirmed', ledger: 500 }),
      );

      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', 'Bearer test-session')
        .send({
          requestId: REQUEST_ID,
          txHash: TX_HASH,
          walletAddress: WALLET,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmed');
      expect(res.body.ledger).toBe(500);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('returns existing transaction on duplicate txHash', async () => {
      (prisma.transaction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTx({ id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', status: 'submitted' }),
      );

      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', 'Bearer test-session')
        .send({
          requestId: REQUEST_ID,
          txHash: TX_HASH,
          walletAddress: WALLET,
        });

      expect(res.status).toBe(200);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('rejects wallet address mismatch', async () => {
      mockVerifySession.mockResolvedValue({
        walletAddress: WALLET,
        sessionToken: 'test-session',
      });

      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', 'Bearer test-session')
        .send({
          requestId: REQUEST_ID,
          txHash: TX_HASH,
          walletAddress: OTHER_WALLET,
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/transactions/:requestId', () => {
    it('returns transaction status by requestId', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx());

      const res = await request(app)
        .get(`/api/v1/transactions/${REQUEST_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('awaiting_signature');
      expect(res.body.requestId).toBe(REQUEST_ID);
    });

    it('returns 404 for unknown requestId', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/transactions/${REQUEST_ID}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/transactions', () => {
    it('lists transactions for authenticated wallet', async () => {
      (prisma.transaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeTx(),
        makeTx({ id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', status: 'indexed' }),
      ]);

      const res = await request(app)
        .get('/api/v1/transactions')
        .set('Authorization', 'Bearer test-session');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].status).toBe('awaiting_signature');
      expect(res.body[1].status).toBe('indexed');
    });
  });

  describe('PATCH /api/v1/transactions/:requestId/status', () => {
    it('transitions from awaiting_signature to submitted', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx());
      (prisma.transaction.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx({ status: 'submitted' }));

      const res = await request(app)
        .patch(`/api/v1/transactions/${REQUEST_ID}/status`)
        .set('Authorization', 'Bearer test-session')
        .send({ status: 'submitted' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('submitted');
      expect(broadcast).toHaveBeenCalledWith('transaction.status', expect.objectContaining({
        status: 'submitted',
        previousStatus: 'awaiting_signature',
      }));
    });

    it('transitions from submitted to confirmed', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx({ status: 'submitted' }));
      (prisma.transaction.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx({ status: 'confirmed' }));

      const res = await request(app)
        .patch(`/api/v1/transactions/${REQUEST_ID}/status`)
        .set('Authorization', 'Bearer test-session')
        .send({ status: 'confirmed' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmed');
    });

    it('transitions to failed from any non-terminal state', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx({ status: 'submitted' }));
      (prisma.transaction.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx({ status: 'failed' }));

      const res = await request(app)
        .patch(`/api/v1/transactions/${REQUEST_ID}/status`)
        .set('Authorization', 'Bearer test-session')
        .send({ status: 'failed', message: 'Simulation failed: insufficient funds' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('failed');
    });

    it('rejects invalid transition: awaiting_signature -> confirmed', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx());

      const res = await request(app)
        .patch(`/api/v1/transactions/${REQUEST_ID}/status`)
        .set('Authorization', 'Bearer test-session')
        .send({ status: 'confirmed' });

      expect(res.status).toBe(409);
      expect(res.body.title).toContain('Invalid Status Transition');
    });

    it('rejects transition from terminal indexed state', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx({ status: 'indexed' }));

      const res = await request(app)
        .patch(`/api/v1/transactions/${REQUEST_ID}/status`)
        .set('Authorization', 'Bearer test-session')
        .send({ status: 'failed' });

      expect(res.status).toBe(409);
    });

    it('rejects transition from terminal failed state', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeTx({ status: 'failed' }));

      const res = await request(app)
        .patch(`/api/v1/transactions/${REQUEST_ID}/status`)
        .set('Authorization', 'Bearer test-session')
        .send({ status: 'submitted' });

      expect(res.status).toBe(409);
    });

    it('forbids status update from a different wallet', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTx({ walletAddress: OTHER_WALLET }),
      );

      const res = await request(app)
        .patch(`/api/v1/transactions/${REQUEST_ID}/status`)
        .set('Authorization', 'Bearer test-session')
        .send({ status: 'submitted' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/transactions/:requestId/reconcile', () => {
    it('returns indexed when transaction found in watcher data', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTx({ status: 'submitted' }),
      );
      (prisma.eventCursor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ ledger: 5000 });

      (prisma.transaction.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ id: 'indexed-tx', ledger: 1234, status: 'indexed' });

      const res = await request(app)
        .get(`/api/v1/transactions/${REQUEST_ID}/reconcile`);

      expect(res.status).toBe(200);
      expect(res.body.dbStatus).toBe('submitted');
      expect(res.body.reconciledStatus).toBe('indexed');
      expect(res.body.confirmedInLedger).toBe(true);
      expect(res.body.indexedByWatcher).toBe(true);
      expect(res.body.latestIndexedLedger).toBe(5000);
    });

    it('returns confirmed when tx found in DB but not fully indexed', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTx({ status: 'confirmed' }),
      );
      (prisma.eventCursor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ ledger: 5000 });

      (prisma.transaction.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ id: 'indexed-tx', ledger: 0, status: 'indexed' });

      const res = await request(app)
        .get(`/api/v1/transactions/${REQUEST_ID}/reconcile`);

      expect(res.status).toBe(200);
      expect(res.body.confirmedInLedger).toBe(true);
      expect(res.body.indexedByWatcher).toBe(false);
    });

    it('returns current status when tx not yet in indexer', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTx({ status: 'submitted' }),
      );
      (prisma.eventCursor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ ledger: 5000 });

      (prisma.transaction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/transactions/${REQUEST_ID}/reconcile`);

      expect(res.status).toBe(200);
      expect(res.body.reconciledStatus).toBe('submitted');
      expect(res.body.confirmedInLedger).toBe(false);
      expect(res.body.indexedByWatcher).toBe(false);
    });

    it('preserves terminal states during reconciliation', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTx({ status: 'failed' }),
      );
      (prisma.eventCursor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/transactions/${REQUEST_ID}/reconcile`);

      expect(res.status).toBe(200);
      expect(res.body.reconciledStatus).toBe('failed');
    });

    it('returns 404 for unknown transaction', async () => {
      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/transactions/${REQUEST_ID}/reconcile`);

      expect(res.status).toBe(404);
    });
  });
});
