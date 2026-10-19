import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { startReconciliationSweep, stopReconciliationSweep } = vi.hoisted(() => ({
  startReconciliationSweep: vi.fn(),
  stopReconciliationSweep: vi.fn(),
}));
vi.mock('./services/reconciliationSweep.js', () => ({
  startReconciliationSweep,
  stopReconciliationSweep,
}));

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { port: 0, runReconciliationSweep: true, reconciliationSweepIntervalMs: 12_345 },
}));
vi.mock('./config/index.js', () => ({ config: mockConfig }));

vi.mock('./config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn(), close: vi.fn(() => Promise.resolve()) },
}));
vi.mock('./config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./app.js', () => ({ default: vi.fn() }));
vi.mock('./db/client.js', () => ({ connectDB: vi.fn(() => Promise.resolve()) }));
vi.mock('./events/watcher.js', () => ({ startProductionWatcher: vi.fn(() => Promise.resolve(null)) }));
vi.mock('./services/reconciliationService.js', () => ({
  runProductionReconciliation: vi.fn(() => Promise.resolve()),
}));
vi.mock('./services/wsServer.js', () => ({ attachWebSocketServer: vi.fn() }));
vi.mock('./services/lifecycle.js', () => ({
  registerHttpServer: vi.fn(),
  registerWatcher: vi.fn((timer: ReturnType<typeof setInterval>) => clearInterval(timer)),
  shutdown: vi.fn(() => Promise.resolve()),
}));
vi.mock('http', () => ({
  default: { createServer: vi.fn(() => ({ listen: vi.fn() })) },
}));

type Handler = (...args: unknown[]) => void;

describe('index bootstrap', () => {
  let handlers: Map<string, Handler>;
  let onSpy: { mockRestore: () => void };
  let exitSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    handlers = new Map();
    // Capture process handlers instead of attaching them to the test worker.
    onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return process;
    }) as typeof process.on);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit);
  });

  afterEach(() => {
    onSpy.mockRestore();
    exitSpy.mockRestore();
    mockConfig.runReconciliationSweep = true;
  });

  it('starts the reconciliation sweep with the configured interval', async () => {
    await import('./index.js');

    await vi.waitFor(() => {
      expect(startReconciliationSweep).toHaveBeenCalledWith(12_345);
    });
  });

  it('does not start the sweep when RUN_RECONCILIATION_SWEEP is disabled', async () => {
    mockConfig.runReconciliationSweep = false;
    const { attachWebSocketServer } = await import('./services/wsServer.js');

    await import('./index.js');

    await vi.waitFor(() => {
      expect(attachWebSocketServer).toHaveBeenCalled();
    });
    expect(startReconciliationSweep).not.toHaveBeenCalled();
  });

  it('stops the sweep on SIGTERM', async () => {
    await import('./index.js');
    await vi.waitFor(() => {
      expect(startReconciliationSweep).toHaveBeenCalled();
    });

    handlers.get('SIGTERM')?.();

    expect(stopReconciliationSweep).toHaveBeenCalledTimes(1);
  });
});
