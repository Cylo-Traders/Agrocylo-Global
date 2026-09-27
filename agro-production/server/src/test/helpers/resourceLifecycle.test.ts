import { describe, expect, it, vi } from 'vitest';
import {
  closeTestResources,
  describeLeak,
  detectLeakedResources,
  installIntervalTracker,
  snapshotResources,
  type ResourceCloser,
} from './resourceLifecycle.js';

describe('resource lifecycle helper', () => {
  it('closes every registered resource and reports the names', async () => {
    const closers: ResourceCloser[] = [
      { name: 'pg pool', close: vi.fn() },
      { name: 'Prisma client', close: vi.fn(async () => {}) },
    ];

    const result = await closeTestResources(closers);

    expect(result.closed).toEqual(['pg pool', 'Prisma client']);
    expect(result.failed).toEqual([]);
    for (const closer of closers) expect(closer.close).toHaveBeenCalledOnce();
  });

  it('keeps closing the remaining resources when one fails', async () => {
    const result = await closeTestResources([
      {
        name: 'WebSocket server',
        close: () => {
          throw new Error('server not attached');
        },
      },
      { name: 'pg pool', close: vi.fn() },
    ]);

    expect(result.closed).toEqual(['pg pool']);
    expect(result.failed).toEqual([
      { name: 'WebSocket server', error: 'server not attached' },
    ]);
  });

  it('only reports handle types that can keep the process alive', () => {
    const baseline = snapshotResources();
    baseline.add('Timeout');

    // `Timeout` is left behind by Vitest itself and is handled by the interval
    // tracker instead; an already-open listener is not a leak either.
    expect(detectLeakedResources(baseline)).not.toContain('Timeout');
  });

  it('ignores resources that already existed before the suite started', () => {
    const baseline = snapshotResources();
    baseline.add('TCPServerWrap');

    expect(detectLeakedResources(baseline)).not.toContain('TCPServerWrap');
  });

  it('flags a listening server that outlives the suite', async () => {
    const baseline = snapshotResources();
    const server = await startListeningServer();

    try {
      expect(
        detectLeakedResources(baseline).map((k) => k.toLowerCase()),
      ).toContain('tcpserverwrap');
    } finally {
      await closeServer(server);
    }
  });

  it('counts intervals that were never cleared', () => {
    const tracker = installIntervalTracker();
    const kept = setInterval(() => {}, 60_000);
    const cleared = setInterval(() => {}, 60_000);
    clearInterval(cleared);

    const leaked = tracker.leaked();
    tracker.restore();
    clearInterval(kept);

    expect(leaked).toBe(1);
  });

  it('reports nothing when every interval was cleared', () => {
    const tracker = installIntervalTracker();
    const interval = setInterval(() => {}, 60_000);
    clearInterval(interval);

    const leaked = tracker.leaked();
    tracker.restore();

    expect(leaked).toBe(0);
  });

  it('restores the original timer functions', () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const tracker = installIntervalTracker();

    expect(globalThis.setInterval).not.toBe(originalSetInterval);
    expect(globalThis.clearInterval).not.toBe(originalClearInterval);

    tracker.restore();

    expect(globalThis.setInterval).toBe(originalSetInterval);
    expect(globalThis.clearInterval).toBe(originalClearInterval);
  });

  it('names the owning test file in the diagnostic', () => {
    const message = describeLeak({
      owner: 'src/routes/disputes.test.ts',
      resources: ['TCPServerWrap'],
      intervals: 1,
    });

    expect(message).toContain('src/routes/disputes.test.ts');
    expect(message).toContain('TCPServerWrap');
    expect(message).toContain('1 uncleared setInterval');
    expect(message).toContain('afterAll');
  });
});

async function startListeningServer(): Promise<import('node:http').Server> {
  const { createServer } = await import('node:http');
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function closeServer(server: import('node:http').Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
