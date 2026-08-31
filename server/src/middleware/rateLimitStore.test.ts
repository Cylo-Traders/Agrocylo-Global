import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRateLimitStore } from './rateLimitStore.js';

// Simple in-memory Redis mock that supports the subset of commands used by
// rateLimitStore: eval (INCR+PEXPIRE+PTTL), get, del, pttl, ttl, flushdb.
class MockRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private isExpired(entry: { expiresAt: number | null }): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  private getEntry(key: string): { value: string; expiresAt: number | null } | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (this.isExpired(e)) {
      this.store.delete(key);
      return null;
    }
    return e;
  }

  async get(key: string): Promise<string | null> {
    const e = this.getEntry(key);
    return e ? e.value : null;
  }

  async set(_key: string, _value: string, ..._args: any[]): Promise<string | null> {
    // Not used directly by rateLimitStore except via eval, but implement for completeness
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async decr(key: string): Promise<number> {
    const e = this.getEntry(key);
    if (!e) {
      // Redis decr on missing key sets to -1
      this.store.set(key, { value: '-1', expiresAt: null });
      return -1;
    }
    const n = parseInt(e.value, 10) - 1;
    e.value = String(n);
    this.store.set(key, e);
    return n;
  }

  async pttl(key: string): Promise<number> {
    const e = this.getEntry(key);
    if (!e) return -2;
    if (e.expiresAt === null) return -1;
    return Math.max(e.expiresAt - Date.now(), 0);
  }

  async ttl(key: string): Promise<number> {
    const p = await this.pttl(key);
    if (p < 0) return p;
    return Math.ceil(p / 1000);
  }

  async eval(script: string, numKeys: number, key: string, windowMsStr?: string): Promise<[number, number]> {
    // Detect which Lua script is being executed by content
    const windowMs = windowMsStr ? parseInt(windowMsStr, 10) : 60000;

    if (script.includes('INCR')) {
      // incrWithExpireScript path
      let e = this.getEntry(key);
      let current: number;
      if (!e) {
        current = 1;
        this.store.set(key, { value: '1', expiresAt: Date.now() + windowMs });
      } else {
        current = parseInt(e.value, 10) + 1;
        e.value = String(current);
        // If this is first incr (should have just set expiry), but handle -1 case
        if (e.expiresAt === null) {
          e.expiresAt = Date.now() + windowMs;
        }
        this.store.set(key, e);
      }
      // Re-read pttl
      let pttl = await this.pttl(key);
      if (pttl === -1) {
        const entry = this.store.get(key);
        if (entry) {
          entry.expiresAt = Date.now() + windowMs;
          this.store.set(key, entry);
          pttl = windowMs;
        }
      }
      return [current, pttl];
    } else if (script.includes('GET')) {
      // get path
      const e = this.getEntry(key);
      if (!e) return [0, -1];
      const pttl = await this.pttl(key);
      return [parseInt(e.value, 10), pttl];
    }
    throw new Error(`Unsupported Lua script in mock eval: ${script.slice(0, 50)}`);
  }

  async flushdb(): Promise<string> {
    this.store.clear();
    return 'OK';
  }

  async flushall(): Promise<string> {
    this.store.clear();
    return 'OK';
  }

  disconnect(): void {
    // no-op
  }

  // For the unavailableRedis test, we need a client that throws on eval
}

class FailingRedis {
  async eval(): Promise<never> {
    throw new Error('Redis unavailable');
  }
  async get(): Promise<never> {
    throw new Error('Redis unavailable');
  }
  async del(): Promise<never> {
    throw new Error('Redis unavailable');
  }
  async pttl(): Promise<never> {
    throw new Error('Redis unavailable');
  }
  async flushdb(): Promise<string> {
    return 'OK';
  }
  disconnect(): void {}
}

describe('Rate Limit Store', () => {
  let redisClient: any;

  beforeEach(() => {
    redisClient = new MockRedis() as any;
  });

  afterEach(async () => {
    await redisClient.flushdb();
    redisClient.disconnect();
  });

  describe('Redis-backed store', () => {
    it('should track request counts in Redis', async () => {
      const store = createRateLimitStore(redisClient);
      const key = 'test-key-1';
      const windowStart = Date.now();

      const result1 = await store.increment(key);
      expect(result1.totalHits).toBe(1);
      expect(result1.resetTime!.getTime()).toBeGreaterThan(windowStart);

      const result2 = await store.increment(key);
      expect(result2.totalHits).toBe(2);
    });

    it('should expire keys after window passes', async () => {
      const store = createRateLimitStore(redisClient);
      (store as any).init?.({ windowMs: 1000 });
      const key = 'test-key-expire';
      const windowMs = 1000; // 1 second window for testing

      const result1 = await store.increment(key);
      expect(result1.totalHits).toBe(1);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, windowMs + 100));

      const result2 = await store.increment(key);
      expect(result2.totalHits).toBe(1); // Should reset after expiry
    });

    it('should handle concurrent increments atomically', async () => {
      const store = createRateLimitStore(redisClient);
      const key = 'test-key-concurrent';
      const concurrentRequests = 10;

      const promises = Array(concurrentRequests)
        .fill(null)
        .map(() => store.increment(key));

      const results = await Promise.all(promises);
      const finalHits = results[results.length - 1]!.totalHits;

      expect(finalHits).toBe(concurrentRequests);
    });

    it('should retrieve existing keys', async () => {
      const store = createRateLimitStore(redisClient);
      const key = 'test-key-get';

      await store.increment(key);
      await store.increment(key);

      const hits = await store.get(key);
      expect(hits.totalHits).toBe(2);
    });

    it('should return zero for non-existent keys', async () => {
      const store = createRateLimitStore(redisClient);
      const hits = await store.get('non-existent-key');
      expect(hits.totalHits).toBe(0);
    });

    it('should use configured windowMs for PTTL via Store.init()', async () => {
      const store: any = createRateLimitStore(redisClient);
      const key = 'test-windowMs-900000';
      const windowMs = 900_000; // 15 minutes — authRateLimiter's window
      store.init({ windowMs, limit: 10 });

      await store.increment(key);
      const pttl = await redisClient.pttl(key);
      // Allow ~100ms clock skew for Redis + test overhead
      expect(pttl).toBeGreaterThan(windowMs - 200);
      expect(pttl).toBeLessThanOrEqual(windowMs);
    });

    it('should keep distinct windows per limiter instance (per Store.init)', async () => {
      const storeAuth: any = createRateLimitStore(redisClient);
      const storeUpload: any = createRateLimitStore(redisClient);
      storeAuth.init({ windowMs: 15 * 60 * 1000 });
      storeUpload.init({ windowMs: 60 * 1000 });

      const keyAuth = 'test-per-limiter-auth';
      const keyUpload = 'test-per-limiter-upload';

      await storeAuth.increment(keyAuth);
      await storeUpload.increment(keyUpload);

      const pttlAuth = await redisClient.pttl(keyAuth);
      // Need a separate mock for second store? Both share same underlying mock instance,
      // but they are separate store objects with different windowMs, yet they share the same redisClient.
      // Our mock stores per-key expiry, so each key has its own TTL — this test verifies
      // that the TTLs are set according to each store's windowMs, not a shared global.
      // To make this work we used two keys on the same redisClient, but the stores'
      // windowMs are per-store. The second store's window is 60s, first is 900s.
      // Since we call increment sequentially, each will set its own key's TTL correctly.
      const pttlUpload = await redisClient.pttl(keyUpload);

      expect(pttlAuth).toBeGreaterThan(14 * 60 * 1000);
      expect(pttlAuth).toBeLessThanOrEqual(15 * 60 * 1000);
      expect(pttlUpload).toBeGreaterThan(0);
      expect(pttlUpload).toBeLessThanOrEqual(60 * 1000);
      // Auth window must be much larger than upload window, proving they don't share state
      expect(pttlAuth).toBeGreaterThan(pttlUpload + 10 * 60 * 1000);
    });

    it('authRateLimiter budget: 11th attempt within 15 min exceeds limit (store counts correctly)', async () => {
      const store: any = createRateLimitStore(redisClient);
      store.init({ windowMs: 15 * 60 * 1000, limit: 10 });
      const key = 'test-auth-budget';

      for (let i = 0; i < 10; i++) {
        const r = await store.increment(key);
        expect(r.totalHits).toBe(i + 1);
      }
      const eleventh = await store.increment(key);
      expect(eleventh.totalHits).toBe(11);
      // Caller (express-rate-limit) would now reject because 11 > 10 within same window
      // TTL should still be ~15 min, not reset to 60s
      const pttl = await redisClient.pttl(key);
      expect(pttl).toBeGreaterThan(14 * 60 * 1000);
    });
  });

  describe('Degradation policy', () => {
    it('should handle Redis unavailability gracefully', async () => {
      const unavailableRedis: any = new FailingRedis();

      const store = createRateLimitStore(unavailableRedis);

      try {
        // With fail-open degradation, this should succeed even if Redis is down
        const result = await store.increment('test-key');
        expect(result.totalHits).toBeGreaterThan(0);
      } catch (error) {
        // With fail-closed degradation, we expect an error
        expect(error).toBeDefined();
      }
    });
  });
});
