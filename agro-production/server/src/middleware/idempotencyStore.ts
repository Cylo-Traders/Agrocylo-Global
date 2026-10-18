/**
 * Storage for the idempotency middleware (issue #1208).
 *
 * Responses used to live in a module-level `Map`: entries were only dropped when
 * the same key was requested again after the TTL (unbounded growth) and the
 * cache was per-process, so `fly.toml` replicas never shared idempotency state.
 *
 * `createMemoryIdempotencyStore()` is the single-instance fallback (per-entry
 * TTL, periodic sweep, hard entry cap); `createRedisIdempotencyStore(client)` is
 * selected automatically when `REDIS_URL` is set.
 */
import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import logger from '../config/logger.js';

export interface IdempotencyStoreEntry {
  status: number;
  body: unknown;
  /** sha256 of method + path + body; detects key reuse with a new payload. */
  fingerprint: string;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyStoreEntry | null>;
  set(
    key: string,
    entry: IdempotencyStoreEntry,
    ttlSeconds: number,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  /** Releases the sweeper interval / Redis socket. */
  close(): Promise<void>;
}

/** Upper bound on in-memory entries, so one instance stays bounded under abuse. */
export const MEMORY_STORE_MAX_ENTRIES = 5000;

export interface MemoryIdempotencyStore extends IdempotencyStore {
  /** Drops expired entries; also runs on an unref'd interval. */
  sweep(now?: number): number;
  readonly size: number;
}

export interface MemoryIdempotencyStoreOptions {
  maxEntries?: number;
  sweepIntervalMs?: number;
}

export function createMemoryIdempotencyStore(
  options: MemoryIdempotencyStoreOptions = {},
): MemoryIdempotencyStore {
  const maxEntries = Math.max(
    1,
    options.maxEntries ?? MEMORY_STORE_MAX_ENTRIES,
  );
  const entries = new Map<
    string,
    IdempotencyStoreEntry & { expiresAt: number }
  >();

  const sweep = (now: number = Date.now()): number => {
    let removed = 0;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  };

  // Never keep the event loop alive just to sweep a cache.
  const timer = setInterval(
    () => void sweep(),
    Math.max(1, options.sweepIntervalMs ?? 60_000),
  );
  timer.unref?.();

  return {
    get size() {
      return entries.size;
    },
    sweep,
    get(key) {
      const entry = entries.get(key);
      if (!entry) return Promise.resolve(null);
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return Promise.resolve(null);
      }
      const { status, body, fingerprint } = entry;
      return Promise.resolve({ status, body, fingerprint });
    },
    set(key, entry, ttlSeconds) {
      // Re-inserting keeps Map insertion order meaningful as eviction order.
      entries.delete(key);
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      entries.set(key, { ...entry, expiresAt: Date.now() + ttlSeconds * 1000 });
      return Promise.resolve();
    },
    delete(key) {
      entries.delete(key);
      return Promise.resolve();
    },
    close() {
      clearInterval(timer);
      entries.clear();
      return Promise.resolve();
    },
  };
}

/** Redis store: shared by every instance pointed at the same `REDIS_URL`. */
export function createRedisIdempotencyStore(client: Redis): IdempotencyStore {
  return {
    async get(key) {
      const raw = await client.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as IdempotencyStoreEntry;
      } catch (error) {
        logger.warn('[Idempotency] Dropping unparseable cache entry', {
          error,
        });
        await client.del(key).catch(() => undefined);
        return null;
      }
    },
    async set(key, entry, ttlSeconds) {
      await client.set(key, JSON.stringify(entry), 'EX', ttlSeconds);
    },
    async delete(key) {
      await client.del(key);
    },
    close() {
      // Nothing to flush: drop the socket rather than wait on a QUIT round-trip
      // that may never complete during a Redis outage.
      client.disconnect();
      return Promise.resolve();
    },
  };
}

let store: IdempotencyStore | null = null;

/** Lazily resolves the process-wide store: Redis when configured, else memory. */
export function getIdempotencyStore(): IdempotencyStore {
  if (store) return store;

  if (config.redisUrl) {
    try {
      const client = new Redis(config.redisUrl, {
        retryStrategy: (times: number) => Math.min(times * 50, 2000),
        enableReadyCheck: true,
        // Queue commands while connecting, but never hang a write request
        // during an outage: fail open after 2 attempts.
        maxRetriesPerRequest: 2,
        connectTimeout: 2000,
      });
      client.on('error', (error: Error) =>
        logger.error('[Idempotency] Redis connection error', { error }),
      );
      client.on('connect', () =>
        logger.info(
          '[Idempotency] Redis connected; cache shared across instances',
        ),
      );
      store = createRedisIdempotencyStore(client);
      return store;
    } catch (error) {
      logger.error(
        '[Idempotency] Failed to initialize Redis store, using memory',
        { error },
      );
    }
  }

  store = createMemoryIdempotencyStore();
  return store;
}

/** Releases the store handle (shutdown and tests). Safe to call repeatedly. */
export async function closeIdempotencyStore(): Promise<void> {
  const current = store;
  store = null;
  if (current) await current.close();
}
