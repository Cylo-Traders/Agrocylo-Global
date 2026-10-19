import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";

const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedResponse {
  status: number;
  body: unknown;
  bodyHash: string;
  timestamp: number;
}

/**
 * Storage abstraction so idempotency state can be shared across instances.
 * When REDIS_URL is set, a Redis-backed store is used; otherwise an in-memory
 * store with TTL eviction keeps memory bounded.
 */
export interface IdempotencyStore {
  get(key: string): Promise<CachedResponse | null>;
  set(key: string, value: CachedResponse): Promise<void>;
  delete(key: string): Promise<void>;
}

class MemoryStore implements IdempotencyStore {
  private cache = new Map<string, CachedResponse>();
  private sweeper: NodeJS.Timeout;

  constructor() {
    // Periodically evict expired entries so memory stays bounded even when
    // keys are never requested again.
    this.sweeper = setInterval(() => this.evictExpired(), 60 * 1000);
    if (typeof this.sweeper.unref === "function") this.sweeper.unref();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (now - value.timestamp > CACHE_TTL_MS) this.cache.delete(key);
    }
  }

  async get(key: string): Promise<CachedResponse | null> {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return cached;
  }

  async set(key: string, value: CachedResponse): Promise<void> {
    this.cache.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }
}

class RedisStore implements IdempotencyStore {
  // Minimal structural client interface; the concrete client is injected so
  // this module does not hard-depend on a specific Redis library.
  constructor(private client: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: "PX", ttl: number): Promise<unknown>;
    del(key: string): Promise<unknown>;
  }) {}

  async get(key: string): Promise<CachedResponse | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedResponse;
    } catch {
      return null;
    }
  }

  async set(key: string, value: CachedResponse): Promise<void> {
    await this.client.set(key, JSON.stringify(value), "PX", CACHE_TTL_MS);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}

let store: IdempotencyStore = new MemoryStore();

/**
 * Optionally swap in a Redis-backed store (e.g. when REDIS_URL is configured)
 * so idempotency state is shared across horizontally scaled instances.
 */
export function configureIdempotencyStore(next: IdempotencyStore): void {
  store = next;
}

export function createRedisStore(client: ConstructorParameters<typeof RedisStore>[0]): IdempotencyStore {
  return new RedisStore(client);
}

function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

/**
 * Build a namespaced cache key tied to the route and authenticated wallet so
 * one wallet can never read another wallet's cached response, and the same key
 * reused across different routes cannot collide.
 */
export function buildIdempotencyCacheKey(req: Request): string {
  const rawKey = (req as any).idempotencyKey as string;
  const wallet = ((req as any).walletAddress as string | undefined) ?? "anonymous";
  const route = `${req.method}:${req.baseUrl || ""}${req.path || ""}`;
  return `${route}:${wallet}:${rawKey}`;
}

export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers[IDEMPOTENCY_KEY_HEADER];
  if (!key || typeof key !== "string" || !key.trim()) {
    res.status(400).json({ error: "X-Idempotency-Key header is required" });
    return;
  }
  (req as any).idempotencyKey = key;
  next();
}

export async function getCachedResponse(key: string): Promise<CachedResponse | null> {
  return store.get(key);
}

export async function setCachedResponse(key: string, status: number, body: unknown): Promise<void> {
  await store.set(key, {
    status,
    body,
    bodyHash: hashBody(body),
    timestamp: Date.now(),
  });
}

export async function clearIdempotencyCache(key: string): Promise<void> {
  await store.delete(key);
}

/**
 * Returns true when a cached entry exists but was produced from a different
 * request body, signalling a 409 conflict to the caller.
 */
export function isBodyMismatch(cached: CachedResponse, body: unknown): boolean {
  return cached.bodyHash !== hashBody(body);
}
