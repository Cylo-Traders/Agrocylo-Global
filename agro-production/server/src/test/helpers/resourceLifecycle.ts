/**
 * Shared test lifecycle helper (issue #1064).
 *
 * Vitest used to keep running after the suites finished, which meant a test
 * file had left a live HTTP server, WebSocket server, `pg` pool, Prisma client
 * or `setInterval` behind. The fix is threefold:
 *
 * 1. A registry of named closers, so a setup file can shut down every shared
 *    resource a suite may have started.
 * 2. Two detectors — a residual-handle snapshot and a `setInterval` tracker —
 *    so leftovers are reported *with the name of the file that owns them*.
 * 3. Opt-in strictness via `VITEST_FAIL_ON_LEAKS=1` for CI.
 */

/** A named asynchronous cleanup routine for one shared resource. */
export interface ResourceCloser {
  /** Stable identifier used in leak reports, e.g. `"pg pool"`. */
  readonly name: string;
  /** Idempotent teardown. Must not throw when the resource was never started. */
  close: () => Promise<void> | void;
}

export interface ResourceCloseResult {
  closed: string[];
  failed: Array<{ name: string; error: string }>;
}

export interface LeakDiagnostic {
  /** Path of the test file that owns the handles. */
  owner: string;
  /** Residual handle types, per `process.getActiveResourcesInfo()`. */
  resources: string[];
  /** Intervals the suite created and never cleared. */
  intervals: number;
}

/**
 * `process.getActiveResourcesInfo()` entries that belong to the test runner or
 * to the Node runtime itself and therefore never indicate a leaked resource.
 *
 * `Timeout` is the important one: Vitest 2.x always leaves a pending timeout
 * behind at teardown, so it is detected by {@link IntervalTracker} instead,
 * which is precise enough to ignore runner-owned timers.
 */
const IGNORED_RESOURCES = new Set([
  'immediate',
  'tickobject',
  'pipe',
  'pipewrap',
  'ttywrap',
  'filehandle',
  'fsreqcallback',
  'closereq',
  'timeout',
]);

/**
 * Handle types that keep a Node process alive and are never owned by Vitest
 * itself: listening servers, outbound sockets, pipes, child processes, workers
 * and crypto handles.
 *
 * Matching is case-insensitive because the exact casing of
 * `getActiveResourcesInfo()` changed across Node releases (`TCPServerWrap` on
 * Node 24, `TCPSERVERWRAP` on Node 20).
 */
const BLOCKING_RESOURCES = new Set([
  'tcpserverwrap',
  'tcpwrap',
  'tcpwrapwrap',
  'tcpconnectwrap',
  'tlswrap',
  'udpwrap',
  'pipewrap',
  'zywrap',
  'shutdownwrap',
  'cryptowrap',
  'dnschannel',
  'processwrap',
  'childprocess',
  'worker',
  'workerwrap',
  'httpclientrequest',
]);

/** Deduplicated snapshot of the currently active libuv resources. */
export function snapshotResources(): Set<string> {
  const available: (() => string[]) | undefined = (
    process as unknown as { getActiveResourcesInfo?: () => string[] }
  ).getActiveResourcesInfo;
  if (typeof available !== 'function') return new Set();
  return new Set(
    available().filter((kind) => !IGNORED_RESOURCES.has(kind.toLowerCase())),
  );
}

/**
 * Resources that were not present when the suite started, restricted to the
 * types that can actually keep the worker alive.
 */
export function detectLeakedResources(baseline: ReadonlySet<string>): string[] {
  const ignored = new Set([...baseline].map((kind) => kind.toLowerCase()));
  return [...snapshotResources()]
    .filter((kind) => !ignored.has(kind.toLowerCase()))
    .filter((kind) => BLOCKING_RESOURCES.has(kind.toLowerCase()))
    .sort();
}

export function describeLeak(diagnostic: LeakDiagnostic): string {
  const parts = [`[vitest] open handle(s) after ${diagnostic.owner}`];
  if (diagnostic.resources.length > 0)
    parts.push(diagnostic.resources.join(', '));
  if (diagnostic.intervals > 0) {
    parts.push(`${diagnostic.intervals} uncleared setInterval handle(s)`);
  }
  parts.push(
    '[vitest] the owner is the test file named above: add the missing close to its',
    '[vitest] afterAll, or register the resource in src/test/setup.ts CLOSERS.',
  );
  return parts.join('\n');
}

export interface IntervalTracker {
  /** Intervals created since installation that are still active. */
  leaked: () => number;
  /** Puts the original timer functions back. */
  restore: () => void;
}

/**
 * Records every `setInterval` created while the suite runs and forgets the ones
 * the suite clears.
 *
 * Unlike a residual-handle diff this is exact: Vitest only ever schedules
 * `setTimeout`s of its own, so an interval that is still active at teardown is
 * a genuine leak. `clearInterval` has to be intercepted as well because Node's
 * `Timeout.hasRef()` keeps reporting `true` after the timer is destroyed.
 */
export function installIntervalTracker(): IntervalTracker {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalClearTimeout = globalThis.clearTimeout;
  const active = new Set<ReturnType<typeof setInterval>>();

  globalThis.setInterval = (...args: Parameters<typeof setInterval>) => {
    const handle = originalSetInterval(...args);
    active.add(handle);
    return handle;
  };

  const forget = (handle: ReturnType<typeof setInterval>) => {
    active.delete(handle);
  };
  globalThis.clearInterval = ((handle?: ReturnType<typeof setInterval>) => {
    if (handle !== undefined) forget(handle);
    return (
      originalClearInterval as (h?: ReturnType<typeof setInterval>) => void
    )(handle);
  }) as typeof clearInterval;
  globalThis.clearTimeout = ((handle?: ReturnType<typeof setInterval>) => {
    if (handle !== undefined) forget(handle);
    return (
      originalClearTimeout as (h?: ReturnType<typeof setInterval>) => void
    )(handle);
  }) as typeof clearTimeout;

  return {
    leaked: () => {
      let count = 0;
      for (const handle of active) {
        // An `unref()`ed interval cannot keep the worker alive, so it is not a
        // leak. `express-rate-limit`'s MemoryStore deliberately unrefs its
        // cleanup interval for exactly that reason.
        if ((handle as { hasRef?: () => boolean }).hasRef?.() === false)
          continue;
        count += 1;
      }
      return count;
    },
    restore: () => {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
      globalThis.clearTimeout = originalClearTimeout;
      active.clear();
    },
  };
}

/** Runs every registered closer, collecting failures instead of aborting. */
export async function closeTestResources(
  closers: readonly ResourceCloser[],
): Promise<ResourceCloseResult> {
  const result: ResourceCloseResult = { closed: [], failed: [] };
  for (const closer of closers) {
    try {
      await closer.close();
      result.closed.push(closer.name);
    } catch (error) {
      result.failed.push({
        name: closer.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
