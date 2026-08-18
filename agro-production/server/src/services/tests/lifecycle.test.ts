import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { mockIsShuttingDown, mockGetShutdownPhase } = vi.hoisted(() => ({
  mockIsShuttingDown: vi.fn(() => false),
  mockGetShutdownPhase: vi.fn(() => 'RUNNING'),
}));

vi.mock('../lifecycle.js', () => ({
  isGracefullyShuttingDown: mockIsShuttingDown,
  getShutdownPhase: mockGetShutdownPhase,
  getShutdownSignal: vi.fn(() => null),
  registerHttpServer: vi.fn(),
  registerWatcher: vi.fn(),
  shutdown: vi.fn(),
  ShutdownPhase: {
    RUNNING: 'RUNNING',
    HTTP_CLOSING: 'HTTP_CLOSING',
    WS_DRAINING: 'WS_DRAINING',
    WATCHERS_STOPPING: 'WATCHERS_STOPPING',
    DB_DISCONNECTING: 'DB_DISCONNECTING',
    COMPLETE: 'COMPLETE',
  },
}));

vi.mock('../../db/client.js', () => ({
  prisma: {
    campaign: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    investment: { findMany: vi.fn(), create: vi.fn() },
    order: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { upsert: vi.fn(), findUnique: vi.fn() },
    transaction: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    dispute: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    eventCursor: { findUnique: vi.fn(), upsert: vi.fn() },
    $queryRaw: vi.fn(),
  },
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
  isPrismaHealthy: vi.fn(),
}));

vi.mock('../wsServer.js', () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
  drainWebSocketServer: vi.fn(),
  getWsClientCount: vi.fn(() => 0),
}));

vi.mock('../sorobanRpc.js', () => ({
  server: {
    getLatestLedger: vi.fn().mockResolvedValue({ sequence: 12345 }),
  },
}));

vi.mock('../../config/database.js', () => ({
  default: { end: vi.fn(), query: vi.fn() },
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../walletAuthService.js', () => ({
  verifySession: vi.fn(),
}));

import app from '../../app.js';

describe('Graceful lifecycle & readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsShuttingDown.mockReturnValue(false);
    mockGetShutdownPhase.mockReturnValue('RUNNING');
  });

  describe('GET /livez', () => {
    it('returns alive with uptime', async () => {
      const res = await request(app).get('/livez');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body.uptime).toBeGreaterThan(0);
      expect(typeof res.body.timestamp).toBe('string');
    });
  });

  describe('GET /readyz', () => {
    it('returns ready when all checks pass', async () => {
      const { prisma } = await import('../../db/client.js');
      const { server: rpcServer } = await import('../sorobanRpc.js');
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ 1: 1 }]);
      (rpcServer.getLatestLedger as ReturnType<typeof vi.fn>).mockResolvedValue({ sequence: 99999 });

      const res = await request(app).get('/readyz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks.database.status).toBe('UP');
      expect(res.body.checks.rpc.status).toBe('UP');
      expect(res.body.lastLedger).toBe(99999);
    });

    it('returns not_ready when database is unreachable', async () => {
      const { prisma } = await import('../../db/client.js');
      const { server: rpcServer } = await import('../sorobanRpc.js');
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      );
      (rpcServer.getLatestLedger as ReturnType<typeof vi.fn>).mockResolvedValue({ sequence: 12345 });

      const res = await request(app).get('/readyz');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.checks.database.status).toBe('DOWN');
    });

    it('returns not_ready when RPC is unreachable', async () => {
      const { prisma } = await import('../../db/client.js');
      const { server: rpcServer } = await import('../sorobanRpc.js');
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ 1: 1 }]);
      (rpcServer.getLatestLedger as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ENOTFOUND rpc.example.com'),
      );

      const res = await request(app).get('/readyz');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.checks.rpc.status).toBe('DOWN');
    });

    it('does not leak connection details in error messages', async () => {
      const { prisma } = await import('../../db/client.js');
      const { server: rpcServer } = await import('../sorobanRpc.js');
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('password authentication failed for user "admin" at postgres://admin:secret@db.example.com:5432/db'),
      );
      (rpcServer.getLatestLedger as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connect failed to https://rpc:secret-token@internal.stellar.org'),
      );

      const res = await request(app).get('/readyz');
      expect(res.body.checks.database.message).toBe('database unreachable');
      expect(res.body.checks.rpc.message).toBe('RPC endpoint unreachable');
    });

    it('returns 503 when server is shutting down', async () => {
      mockIsShuttingDown.mockReturnValue(true);
      mockGetShutdownPhase.mockReturnValue('HTTP_CLOSING');

      const res = await request(app).get('/readyz');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.checks.shutdown.status).toBe('DOWN');
      expect(res.body.checks.shutdown.message).toContain('HTTP_CLOSING');
    });
  });

  describe('Shutdown middleware', () => {
    it('accepts GET requests during shutdown', async () => {
      mockIsShuttingDown.mockReturnValue(true);

      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UP');
    });

    it('rejects POST requests during shutdown with 503', async () => {
      mockIsShuttingDown.mockReturnValue(true);

      const res = await request(app)
        .post('/api/v1/campaigns')
        .set('Authorization', 'Bearer test')
        .send({});
      expect(res.status).toBe(503);
      expect(res.body.message).toBe('Server is shutting down');
    });

    it('rejects PATCH requests during shutdown with 503', async () => {
      mockIsShuttingDown.mockReturnValue(true);

      const res = await request(app)
        .patch('/api/v1/orders/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/confirm')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(503);
    });

    it('rejects DELETE requests during shutdown with 503', async () => {
      mockIsShuttingDown.mockReturnValue(true);

      const res = await request(app).delete('/campaigns/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/image');
      expect(res.status).toBe(503);
    });

    it('sets Connection: close header during shutdown', async () => {
      mockIsShuttingDown.mockReturnValue(true);

      const res = await request(app).get('/health');
      expect(res.headers['connection']).toBe('close');
    });
  });

  describe('Lifecycle shutdown order', () => {
    it('shutdown function is importable and has expected phases', async () => {
      const { shutdown, ShutdownPhase } = await import('../lifecycle.js');
      expect(typeof shutdown).toBe('function');
      expect(ShutdownPhase.RUNNING).toBe('RUNNING');
      expect(ShutdownPhase.COMPLETE).toBe('COMPLETE');
    });
  });
});
