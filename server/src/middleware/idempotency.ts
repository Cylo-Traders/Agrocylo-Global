import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Idempotency middleware.
 *
 * Keys are namespaced by route + authenticated wallet so that one wallet can
 * never read another wallet's cached response, and the same raw key reused
 * across different routes cannot return a wrongly shaped body.
 *
 * Storage is behind a small store abstraction. When REDIS_URL is set the store
 * is Redis-backed (shared across horizontally scaled instances); otherwise an
 * in-memory store with TTL eviction is used so memory stays bounded even when
 * entries are never requested again.
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CachedEntry {
  bodyHash: string;
  status: number;
  body: unknown;
  expiresAt: number;
}

interface IdempotencyStore {
  get(key: string): Promise<CachedEntry | null>;
  set(key: string, entry: CachedEntry, ttlMs: number): Promise<void>;
}

class MemoryStore implements IdempotencyStore {
  private readonly map = new Map<string, CachedEntry>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    // Periodically evict expired entries so memory is bounded without a
    // follow-up request for the exact key.
    this.sweeper = setInterval(() => this.sweep(), Math.min(TTL_MS, 60_000));
    if (typeof this.sweeper.unref === 'function') this.sweeper.unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }

  async get(key: string): Promise<CachedEntry | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry;
  }

  async set(key: string, entry: CachedEntry, ttlMs: number): Promise<void> {
    this.map.set(key, { ...entry, expiresAt: Date.now() + ttlMs });
  }
}

class RedisStore implements IdempotencyStore {
  // Lazily required so the module works without a Redis client installed when
  // REDIS_URL is unset. The client is created on first use.
  private client: any;

  constructor(private readonly url: string) {}

  private getClient(): any {
    if (!this.client) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createClient } = require('redis');
      this.client = createClient({ url: this.url });
      this.client.connect().catch(() => {
        /* connection errors surface on individual commands */
      });
    }
    return this.client;
  }

  async get(key: string): Promise<CachedEntry | null> {
    const raw = await this.getClient().get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedEntry;
    } catch {
      return null;
    }
  }

  async set(key: string, entry: CachedEntry, ttlMs: number): Promise<void> {
    await this.getClient().set(key, JSON.stringify(entry), { PX: ttlMs });
  }
}

let store: IdempotencyStore | null = null;

function getStore(): IdempotencyStore {
  if (!store) {
    const redisUrl = process.env.REDIS_URL;
    store = redisUrl ? new RedisStore(redisUrl) : new MemoryStore();
  }
  return store;
}

function hashBody(body: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

function resolveWallet(req: Request): string {
  const r = req as Request & {
    walletAddress?: string;
    user?: { walletAddress?: string };
  };
  return (
    r.walletAddress ||
    r.user?.walletAddress ||
    (typeof req.headers['x-wallet-address'] === 'string'
      ? (req.headers['x-wallet-address'] as string)
      : '') ||
    'anonymous'
  ).toLowerCase();
}

function buildKey(req: Request, rawKey: string): string {
  const route = `${req.method}:${req.baseUrl || ''}${req.path || ''}`;
  return `idempotency:${route}:${resolveWallet(req)}:${rawKey}`;
}

export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawKey = req.headers['x-idempotency-key'];
  if (typeof rawKey !== 'string' || rawKey.length === 0) {
    next();
    return;
  }

  const key = buildKey(req, rawKey);
  const bodyHash = hashBody(req.body);
  const currentStore = getStore();

  try {
    const cached = await currentStore.get(key);
    if (cached) {
      if (cached.bodyHash !== bodyHash) {
        res.status(409).json({
          error: 'Idempotency key reused with a different request body',
        });
        return;
      }
      res.status(cached.status).json(cached.body);
      return;
    }
  } catch {
    // On store failure, fail open and let the request proceed.
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      currentStore
        .set(key, { bodyHash, status: res.statusCode, body, expiresAt: 0 }, TTL_MS)
        .catch(() => {
          /* best-effort caching */
        });
    }
    return originalJson(body);
  };

  next();
}

export default idempotency;
