import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getIndexerStatus } = vi.hoisted(() => ({ getIndexerStatus: vi.fn() }));

vi.mock('./services/indexerStatus.js', () => ({ getIndexerStatus }));

vi.mock('./config/database.js', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));

vi.mock('./config/supabase.js', () => ({
  getSupabaseAdmin: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    }),
  }),
}));

import app from './app.js';

describe('GET /health/indexer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with freshness details when the indexer is fresh', async () => {
    getIndexerStatus.mockResolvedValue({
      enabled: true,
      status: 'fresh',
      contractIds: ['C-market'],
      lastProcessedLedger: 1000,
      latestLedger: 1005,
      ledgerLag: 5,
      lastProgressAt: '2026-01-01T00:00:00Z',
      secondsSinceProgress: 5,
    });

    const res = await request(app).get('/health/indexer');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fresh');
    expect(res.body.lastProcessedLedger).toBe(1000);
    expect(res.body.ledgerLag).toBe(5);
  });

  it('returns 200 when the watcher is explicitly disabled', async () => {
    getIndexerStatus.mockResolvedValue({ enabled: false, status: 'disabled' });

    const res = await request(app).get('/health/indexer');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disabled');
  });

  it('returns 503 when the indexer is stalled', async () => {
    getIndexerStatus.mockResolvedValue({
      enabled: true,
      status: 'stalled',
      lastProcessedLedger: 1000,
      latestLedger: 5000,
      ledgerLag: 4000,
    });

    const res = await request(app).get('/health/indexer');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('stalled');
  });

  it('returns 503 with unknown status when the check itself fails', async () => {
    getIndexerStatus.mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/health/indexer');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unknown');
  });
});
