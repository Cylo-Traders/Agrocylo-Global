import { describe, it, expect, vi, beforeEach } from 'vitest';

const { startReconciliationSweep, stopReconciliationSweep, shutdown, listen } = vi.hoisted(() => ({
  startReconciliationSweep: vi.fn(),
  stopReconciliationSweep: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
}));

vi.mock('../services/reconciliationSweep.js', () => ({
  startReconciliationSweep,
  stopReconciliationSweep,
}));
vi.mock('../config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn(), close: vi.fn().mockResolvedValue(true) },
}));
vi.mock('../app.js', () => ({ default: vi.fn() }));
vi.mock('../db/client.js', () => ({ connectDB: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../events/watcher.js', () => ({ startProductionWatcher: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/reconciliationService.js', () => ({ runProductionReconciliation: vi.fn() }));
vi.mock('../services/wsServer.js', () => ({ attachWebSocketServer: vi.fn() }));
vi.mock('../services/lifecycle.js', () => ({
  registerHttpServer: vi.fn(),
  registerWatcher: vi.fn((handle: ReturnType<typeof setInterval>) => clearInterval(handle)),
  shutdown,
}));
vi.mock('http', () => ({ default: { createServer: vi.fn(() => ({ listen })) } }));

describe('bootstrap (Issue #1205)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env['RUN_RECONCILIATION_SWEEP'];
    delete process.env['RECONCILIATION_SWEEP_INTERVAL_MS'];
  });

  async function boot(): Promise<void> {
    const before = new Set(process.listeners('SIGTERM'));
    await import('../index.js');
    await vi.waitFor(() => expect(listen).toHaveBeenCalled());
    // Drop the signal handlers index.ts registered so they do not leak.
    for (const sig of ['SIGTERM', 'SIGINT', 'unhandledRejection', 'uncaughtException'] as const) {
      for (const l of process.listeners(sig)) if (!before.has(l as never)) process.removeListener(sig, l);
    }
  }

  it('starts the reconciliation sweep with the configured interval', async () => {
    process.env['RECONCILIATION_SWEEP_INTERVAL_MS'] = '60000';
    await boot();
    expect(startReconciliationSweep).toHaveBeenCalledTimes(1);
    expect(startReconciliationSweep).toHaveBeenCalledWith(60000);
  });

  it('defaults the sweep interval to 5 minutes', async () => {
    await boot();
    expect(startReconciliationSweep).toHaveBeenCalledWith(300000);
  });

  it('does not start the sweep when RUN_RECONCILIATION_SWEEP=false', async () => {
    process.env['RUN_RECONCILIATION_SWEEP'] = 'false';
    await boot();
    expect(startReconciliationSweep).not.toHaveBeenCalled();
  });
});
