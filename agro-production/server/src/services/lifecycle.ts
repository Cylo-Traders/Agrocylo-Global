import http from 'http';
import logger from '../config/logger.js';
import { disconnectDB } from '../db/client.js';
import { closeWebSocketServer, drainWebSocketServer } from './wsServer.js';
import { config } from '../config/index.js';
import pool from '../config/database.js';

type WatcherHandle = { stop: () => void } | ReturnType<typeof setInterval>;

export enum ShutdownPhase {
  RUNNING = 'RUNNING',
  HTTP_CLOSING = 'HTTP_CLOSING',
  WS_DRAINING = 'WS_DRAINING',
  WATCHERS_STOPPING = 'WATCHERS_STOPPING',
  DB_DISCONNECTING = 'DB_DISCONNECTING',
  COMPLETE = 'COMPLETE',
}

const watchers: WatcherHandle[] = [];
let server: http.Server | null = null;
let shutdownPhase: ShutdownPhase = ShutdownPhase.RUNNING;
let shutdownSignal: string | null = null;

export function registerWatcher(handle: WatcherHandle): void {
  watchers.push(handle);
}

export function getWatchers(): WatcherHandle[] {
  return watchers;
}

/**
 * Stops every watcher registered via {@link registerWatcher}.
 *
 * Exported so test teardown can release watcher `setInterval` handles without
 * running the full {@link shutdown} sequence (issue #1064).
 */
export function stopRegisteredWatchers(): void {
  stopAllWatchers();
}

function stopAllWatchers(): void {
  for (const handle of watchers) {
    if (
      typeof handle === 'object' &&
      'stop' in handle &&
      typeof handle.stop === 'function'
    ) {
      handle.stop();
    } else {
      clearInterval(handle as ReturnType<typeof setInterval>);
    }
  }
  watchers.length = 0;
  logger.info('All watchers stopped');
}

export function registerHttpServer(s: http.Server): void {
  server = s;
}

export function isGracefullyShuttingDown(): boolean {
  return shutdownPhase !== ShutdownPhase.RUNNING;
}

export function getShutdownPhase(): ShutdownPhase {
  return shutdownPhase;
}

export function getShutdownSignal(): string | null {
  return shutdownSignal;
}

function promisifyServerClose(
  s: http.Server,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      logger.warn(
        `HTTP server close timed out after ${timeoutMs}ms, forcing close`,
      );
      s.closeAllConnections?.();
      resolve();
    }, timeoutMs);

    s.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function shutdown(signal?: string): Promise<void> {
  if (shutdownPhase !== ShutdownPhase.RUNNING) return;

  shutdownPhase = ShutdownPhase.HTTP_CLOSING;
  shutdownSignal = signal ?? 'shutdown command';

  logger.info(`Received ${shutdownSignal} — starting graceful shutdown`);

  // Phase 1: Stop accepting new HTTP requests
  if (server) {
    shutdownPhase = ShutdownPhase.HTTP_CLOSING;
    logger.info('Closing HTTP server to new connections');
    await promisifyServerClose(server, config.shutdownTimeoutMs);
    logger.info('HTTP server closed');
  }

  // Phase 2: Drain WebSocket connections
  shutdownPhase = ShutdownPhase.WS_DRAINING;
  try {
    await Promise.race([
      drainWebSocketServer(),
      new Promise((resolve) => setTimeout(resolve, config.shutdownTimeoutMs)),
    ]);
  } catch (err) {
    logger.warn('WebSocket drain error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  await closeWebSocketServer();
  logger.info('WebSocket server closed');

  // Phase 3: Stop indexer watchers
  shutdownPhase = ShutdownPhase.WATCHERS_STOPPING;
  stopAllWatchers();

  // Phase 4: Disconnect databases
  shutdownPhase = ShutdownPhase.DB_DISCONNECTING;
  await disconnectDB();
  try {
    await pool.end();
    logger.info('Raw database pool disconnected');
  } catch {
    // pool may already be ended
  }

  shutdownPhase = ShutdownPhase.COMPLETE;
  logger.info('Graceful shutdown complete');
}
