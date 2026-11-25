import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { isSupabaseConfigured } from './config/supabase.js';

const mockQueryRaw = vi.hoisted(() => vi.fn());
const mockSupabaseFrom = vi.hoisted(() => vi.fn());

describe('isSupabaseConfigured (#1423)', () => {
  it('returns false for empty or placeholder Supabase credentials', () => {
    expect(isSupabaseConfigured('', '')).toBe(false);
    expect(
      isSupabaseConfigured(
        'https://placeholder.supabase.co',
        'placeholder-service-role-key',
      ),
    ).toBe(false);
    expect(
      isSupabaseConfigured(
        'https://YOUR_PROJECT_REF.supabase.co',
        'YOUR_SUPABASE_SERVICE_ROLE_KEY',
      ),
    ).toBe(false);
    expect(
      isSupabaseConfigured(
        'https://your-project.supabase.co',
        'your-service-role-key',
      ),
    ).toBe(false);
  });

  it('returns true when real Supabase URL and service role key are provided', () => {
    expect(
      isSupabaseConfigured(
        'https://abcxyz12345.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.real-service-role-key',
      ),
    ).toBe(true);
  });
});

describe('Split liveness and readiness health endpoints (#1423)', () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
    mockSupabaseFrom.mockReset();
  });

  function createHealthTestApp(options: {
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
    runContractWatcher: boolean;
  }) {
    const app = express();
    const supabaseEnabled = isSupabaseConfigured(
      options.supabaseUrl,
      options.supabaseServiceRoleKey,
    );

    const buildLiveness = () => ({
      status: 'UP' as const,
      timestamp: new Date().toISOString(),
      service: 'Agrocylo-Backend',
      env: 'test',
    });

    app.get('/health/live', (_req, res) => {
      res.status(200).json(buildLiveness());
    });

    app.get('/health', (_req, res) => {
      res.status(200).json(buildLiveness());
    });

    app.get('/health/ready', async (_req, res) => {
      const health: {
        status: 'UP' | 'DOWN';
        timestamp: string;
        service: string;
        env: string;
        database: 'UP' | 'DOWN';
        supabase: 'UP' | 'DOWN' | 'DISABLED';
      } = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        service: 'Agrocylo-Backend',
        env: 'test',
        database: 'DOWN',
        supabase: supabaseEnabled ? 'DOWN' : 'DISABLED',
      };

      try {
        await mockQueryRaw();
        health.database = 'UP';
      } catch {
        health.status = 'DOWN';
      }

      if (supabaseEnabled) {
        try {
          const result = await mockSupabaseFrom();
          if (!result?.error) {
            health.supabase = 'UP';
          } else {
            health.status = 'DOWN';
          }
        } catch {
          health.status = 'DOWN';
        }
      }

      res.status(health.status === 'UP' ? 200 : 503).json(health);
    });

    app.get('/health/indexer', (_req, res) => {
      if (!options.runContractWatcher) {
        res.status(200).json({
          enabled: false,
          status: 'disabled',
          contractIds: [],
          lastProcessedLedger: null,
          latestLedger: null,
          ledgerLag: null,
          lastProgressAt: null,
          secondsSinceProgress: null,
        });
        return;
      }
      res.status(200).json({ enabled: true, status: 'fresh' });
    });

    return app;
  }

  it('GET /health/live and GET /health return 200 even with placeholder Supabase credentials', async () => {
    const app = createHealthTestApp({
      supabaseUrl: 'https://placeholder.supabase.co',
      supabaseServiceRoleKey: 'placeholder-service-role-key',
      runContractWatcher: false,
    });

    const liveRes = await request(app).get('/health/live');
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.status).toBe('UP');

    const aliasRes = await request(app).get('/health');
    expect(aliasRes.status).toBe(200);
    expect(aliasRes.body.status).toBe('UP');
  });

  it('GET /health/ready returns 200 with supabase=DISABLED when Postgres is UP and Supabase has placeholder config', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const app = createHealthTestApp({
      supabaseUrl: 'https://placeholder.supabase.co',
      supabaseServiceRoleKey: 'placeholder-service-role-key',
      runContractWatcher: false,
    });

    const readyRes = await request(app).get('/health/ready');
    expect(readyRes.status).toBe(200);
    expect(readyRes.body).toMatchObject({
      status: 'UP',
      database: 'UP',
      supabase: 'DISABLED',
    });
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('GET /health/ready returns 503 when Postgres is DOWN', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('Connection refused'));
    const app = createHealthTestApp({
      supabaseUrl: 'https://placeholder.supabase.co',
      supabaseServiceRoleKey: 'placeholder-service-role-key',
      runContractWatcher: false,
    });

    const readyRes = await request(app).get('/health/ready');
    expect(readyRes.status).toBe(503);
    expect(readyRes.body).toMatchObject({
      status: 'DOWN',
      database: 'DOWN',
      supabase: 'DISABLED',
    });
  });

  it('GET /health/ready checks Supabase when real credentials are configured and returns 503 if Supabase fails', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockSupabaseFrom.mockResolvedValueOnce({ error: new Error('Supabase 500') });

    const app = createHealthTestApp({
      supabaseUrl: 'https://real-project.supabase.co',
      supabaseServiceRoleKey: 'real-service-role-secret-key',
      runContractWatcher: false,
    });

    const failedReady = await request(app).get('/health/ready');
    expect(failedReady.status).toBe(503);
    expect(failedReady.body).toMatchObject({
      status: 'DOWN',
      database: 'UP',
      supabase: 'DOWN',
    });

    mockSupabaseFrom.mockResolvedValueOnce({ error: null });
    const okReady = await request(app).get('/health/ready');
    expect(okReady.status).toBe(200);
    expect(okReady.body).toMatchObject({
      status: 'UP',
      database: 'UP',
      supabase: 'UP',
    });
  });

  it('GET /health/indexer reports disabled (200) when RUN_CONTRACT_WATCHER is false', async () => {
    const app = createHealthTestApp({
      supabaseUrl: 'https://placeholder.supabase.co',
      supabaseServiceRoleKey: 'placeholder-service-role-key',
      runContractWatcher: false,
    });

    const res = await request(app).get('/health/indexer');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: false,
      status: 'disabled',
    });
  });
});
