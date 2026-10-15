import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config/logContext.js', () => ({
  runWithLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock('./connection.js', () => ({ createRedisConnection: () => ({}) }));
vi.mock('./processors/indexing.js', () => ({ processIndexing: vi.fn() }));
vi.mock('./processors/analytics.js', () => ({ processAnalytics: vi.fn() }));
vi.mock('./processors/notifications.js', () => ({ processNotifications: vi.fn() }));

const { FakeWorker, FakeQueueEvents } = await vi.hoisted(async () => {
  // Import inside the hoisted factory: vi.mock factories are hoisted above the
  // module imports, so EventEmitter is not yet initialized at that point.
  const { EventEmitter } = await import('node:events');

  class FakeWorker extends EventEmitter {
    name: string;
    close = vi.fn();
    constructor(name: string) {
      super();
      this.name = name;
    }
  }
  class FakeQueueEvents extends EventEmitter {
    close = vi.fn();
  }
  return { FakeWorker, FakeQueueEvents };
});
vi.mock('bullmq', () => ({ Worker: FakeWorker, QueueEvents: FakeQueueEvents }));

const { queueJobLagObserve, queueJobFailuresInc } = vi.hoisted(() => ({
  queueJobLagObserve: vi.fn(),
  queueJobFailuresInc: vi.fn(),
}));
vi.mock('../services/promMetrics.js', () => ({
  queueJobLagSeconds: { observe: queueJobLagObserve },
  queueJobFailuresTotal: { inc: queueJobFailuresInc },
}));

const { captureAlert } = vi.hoisted(() => ({ captureAlert: vi.fn() }));
vi.mock('../config/sentry.js', () => ({ captureAlert }));

import { startWorkers } from './workers.js';

describe('workers — queue lag and failure alerting (Issue #756)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records queue lag when a job becomes active', () => {
    const { workers } = startWorkers();
    const analytics = workers.find((w: any) => w.name === 'analytics')!;

    const enqueuedAt = Date.now() - 5_000;
    analytics.emit('active', {
      id: '1',
      name: 'aggregate-price-index',
      timestamp: enqueuedAt,
      attemptsMade: 1,
    });

    expect(queueJobLagObserve).toHaveBeenCalledWith({ queue: 'analytics' }, expect.any(Number));
    const lag = queueJobLagObserve.mock.calls[0]?.[1];
    expect(lag).toBeGreaterThanOrEqual(4.9);
  });

  it('does not alert on a failure that still has retries remaining', () => {
    const { workers } = startWorkers();
    const analytics = workers.find((w: any) => w.name === 'analytics')!;

    const job = { id: '1', name: 'aggregate-price-index', attemptsMade: 1, opts: { attempts: 5 } };
    analytics.emit('failed', job, new Error('transient'));

    expect(queueJobFailuresInc).toHaveBeenCalledWith({
      queue: 'analytics',
      job: 'aggregate-price-index',
    });
    expect(captureAlert).not.toHaveBeenCalled();
  });

  it('alerts once a job has exhausted all its retry attempts', () => {
    const { workers } = startWorkers();
    const analytics = workers.find((w: any) => w.name === 'analytics')!;

    const job = { id: '1', name: 'aggregate-price-index', attemptsMade: 5, opts: { attempts: 5 } };
    analytics.emit('failed', job, new Error('still failing'));

    expect(captureAlert).toHaveBeenCalledWith(
      'scheduled_job_failed',
      expect.stringContaining('aggregate-price-index'),
      expect.objectContaining({ queue: 'analytics', jobName: 'aggregate-price-index' })
    );
  });
});
