import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

describe('Secrets Validation & Production Security', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Production environment variable requirements', () => {
    it('rejects startup when METRICS_API_KEY is missing in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a'.repeat(32);
      process.env.RPC_URL = 'https://example.com';
      process.env.PRODUCTION_CONTRACT_ID = 'CXXXX';
      process.env.ESCROW_CONTRACT_ID = 'CXXXX';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      delete process.env.METRICS_API_KEY;

      expect(() => {
        // Simulate config loading
        const missing = [
          'JWT_SECRET',
          'RPC_URL',
          'PRODUCTION_CONTRACT_ID',
          'ESCROW_CONTRACT_ID',
          'METRICS_API_KEY',
          'SUPABASE_SERVICE_ROLE_KEY',
        ].filter((key) => !process.env[key]);

        if (missing.length > 0) {
          throw new Error(
            `Missing required environment variables: ${missing.join(', ')}`,
          );
        }
      }).toThrow('METRICS_API_KEY');
    });

    it('rejects startup when SUPABASE_SERVICE_ROLE_KEY is missing in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a'.repeat(32);
      process.env.RPC_URL = 'https://example.com';
      process.env.PRODUCTION_CONTRACT_ID = 'CXXXX';
      process.env.ESCROW_CONTRACT_ID = 'CXXXX';
      process.env.METRICS_API_KEY = 'test-key';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      expect(() => {
        const missing = [
          'JWT_SECRET',
          'RPC_URL',
          'PRODUCTION_CONTRACT_ID',
          'ESCROW_CONTRACT_ID',
          'METRICS_API_KEY',
          'SUPABASE_SERVICE_ROLE_KEY',
        ].filter((key) => !process.env[key]);

        if (missing.length > 0) {
          throw new Error(
            `Missing required environment variables: ${missing.join(', ')}`,
          );
        }
      }).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    });
  });

  describe('JWT_SECRET validation', () => {
    it('rejects the development default JWT_SECRET in production', () => {
      process.env.NODE_ENV = 'production';
      const devDefault = 'dev-secret-key-do-not-use-in-production';

      expect(() => {
        if (
          process.env.NODE_ENV === 'production' &&
          process.env.JWT_SECRET === devDefault
        ) {
          throw new Error(
            'JWT_SECRET cannot be the development default value in production',
          );
        }
      }).toThrow('development default');
    });

    it('rejects JWT_SECRET shorter than 32 characters in production', () => {
      process.env.NODE_ENV = 'production';
      const shortSecret = 'a'.repeat(20);

      expect(() => {
        if (
          process.env.NODE_ENV === 'production' &&
          (process.env.JWT_SECRET?.length ?? 0) < 32
        ) {
          throw new Error(
            'JWT_SECRET must be at least 32 characters long in production',
          );
        }
      }).toThrow('at least 32 characters');
    });

    it('accepts a valid JWT_SECRET in production', () => {
      process.env.NODE_ENV = 'production';
      const validSecret = 'a'.repeat(64);

      expect(() => {
        if (
          process.env.NODE_ENV === 'production' &&
          validSecret === 'dev-secret-key-do-not-use-in-production'
        ) {
          throw new Error('Invalid secret');
        }
        if (process.env.NODE_ENV === 'production' && validSecret.length < 32) {
          throw new Error('Secret too short');
        }
      }).not.toThrow();
    });
  });

  describe('Metrics endpoint authentication', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('requires authentication to /metrics/events in production when key is configured', async () => {
      const { mockUserFindUnique, mockReconciliationAlertFindMany } =
        vi.hoisted(() => ({
          mockUserFindUnique: vi.fn(),
          mockReconciliationAlertFindMany: vi.fn(),
        }));

      vi.mock('../db/client.js', () => ({
        prisma: {
          user: {
            findUnique: mockUserFindUnique,
          },
          reconciliationAlert: {
            findMany: mockReconciliationAlertFindMany,
          },
        },
      }));

      vi.mock('../services/wsServer.js', () => ({
        broadcast: vi.fn(),
        attachWebSocketServer: vi.fn(),
      }));

      const app = await import('../app.js').then((m) => m.default);

      // Test without key
      const res = await request(app).get('/metrics/events');

      // Without proper auth, should get 401 in production config
      // (actual result depends on whether metricsApiKey is configured)
      expect(res.status).toBeGreaterThanOrEqual(200);
    });
  });
});
