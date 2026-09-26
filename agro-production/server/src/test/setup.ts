import { afterAll, beforeAll, expect } from 'vitest';
import {
  closeTestResources,
  describeLeak,
  detectLeakedResources,
  installIntervalTracker,
  snapshotResources,
  type ResourceCloser,
} from './helpers/resourceLifecycle.js';

/**
 * Per-file Vitest setup: guarantees that a suite releases the shared server
 * resources it may have started, and reports any handle that outlives it
 * (issue #1064).
 *
 * Notes
 * -----
 * - The closers are resolved with dynamic `import()` on purpose. `vi.mock()` is
 *   registered per test file, so a suite that mocked `../db/client.js` resolves
 *   the mock here and there is simply nothing to close.
 * - `src/e2e/**` is excluded from this config (see `vitest.config.ts`); the E2E
 *   suite boots a real HTTP server, WebSocket server, Prisma client, `pg` pool
 *   and watcher intervals and is only meant to run via `npm run test:e2e`.
 * - `VITEST_FAIL_ON_LEAKS=1` turns leftover handles into a test failure. CI can
 *   opt in once the suite baseline is clean; the default reports loudly so a new
 *   leak names its owner without turning an unrelated diff red.
 */

interface MaybeCloser {
  name: string;
  module: string;
  export: string;
}

/**
 * Every shared resource a suite can start, paired with the function that
 * releases it. Add new entries here when a new long-lived handle is introduced:
 * that is what keeps "all resources close in afterAll" true as the app grows.
 */
const CLOSERS: MaybeCloser[] = [
  {
    name: 'WebSocket server',
    module: '../services/wsServer.js',
    export: 'closeWebSocketServer',
  },
  {
    name: 'indexer watchers',
    module: '../services/lifecycle.js',
    export: 'stopRegisteredWatchers',
  },
  { name: 'Prisma client', module: '../db/client.js', export: 'disconnectDB' },
  { name: 'pg pool', module: '../config/database.js', export: 'disconnectDb' },
];

/** Absolute path of the suite this setup instance belongs to. */
function ownerOf(): string {
  return expect.getState().testPath ?? 'unknown test file';
}

const intervals = installIntervalTracker();

/**
 * Handles already open before the suite could have contributed any. The import
 * time snapshot is taken before the test file is evaluated, the pre-test
 * snapshot once Vitest's own runtime handles exist.
 */
const importTimeResources = snapshotResources();
const preTestResources = new Set<string>();
const baseline = new Set<string>();

beforeAll(() => {
  for (const kind of snapshotResources()) preTestResources.add(kind);
  for (const kind of preTestResources) baseline.add(kind);
  for (const kind of importTimeResources) baseline.add(kind);
});

afterAll(async () => {
  const owner = ownerOf();
  const closers: ResourceCloser[] = [];

  for (const candidate of CLOSERS) {
    let close: unknown;
    try {
      const resolved = (await import(
        /* @vite-ignore */ candidate.module
      )) as Record<string, unknown>;
      close = resolved[candidate.export];
    } catch {
      // Either the suite never loaded the module, or it mocked the module
      // without this export (Vitest throws on unknown exports of a mock). In
      // both cases there is no real resource left to close.
      continue;
    }
    if (typeof close !== 'function') continue;
    closers.push({
      name: candidate.name,
      close: () => (close as () => Promise<void> | void)(),
    });
  }

  const { failed } = await closeTestResources(closers);
  for (const failure of failed) {
    console.warn(
      `[vitest] failed to close ${failure.name} (owner: ${owner}): ${failure.error}`,
    );
  }

  // Measured after the closers ran, so a resource the suite did release is not
  // reported, and `unref()`ed intervals count as released.
  const resources = detectLeakedResources(baseline);
  const leakedIntervals = intervals.leaked();
  intervals.restore();

  if (resources.length > 0 || leakedIntervals > 0) {
    const message = describeLeak({
      owner,
      resources,
      intervals: leakedIntervals,
    });
    if (process.env['VITEST_FAIL_ON_LEAKS'] === '1') throw new Error(message);
    console.warn(message);
  }
});
