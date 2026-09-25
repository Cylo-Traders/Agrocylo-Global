import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import Redis from 'ioredis';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { ApiError, sendProblem } from '../http/errors.js';
import { createRateLimitStore } from './rateLimitStore.js';

const isTest = process.env['NODE_ENV'] === 'test';
const shouldSkipInTest = () => isTest && process.env['ENABLE_TEST_RATE_LIMIT'] !== 'true';

// Initialize shared Redis client for all rate limiters
// NOTE: Each limiter gets its own store instance so Store.init(options) can
// capture the correct windowMs per limiter (fix for the 60s-everywhere bug).
// Sharing a single store would cause the last init() to overwrite earlier
// windows, e.g. auth's 15 min becoming 1 min.
export let sharedRedisClient: Redis | null = null;

function createStoreForLimiter(): ReturnType<typeof createRateLimitStore> | undefined {
  if (!sharedRedisClient) return undefined;
  return createRateLimitStore(sharedRedisClient);
}

// Legacy single store kept for backwards compatibility (e.g. tests, app.ts
// idempotency import). Prefer createStoreForLimiter() for new limiters.
let rateLimitStore: ReturnType<typeof createRateLimitStore> | null = null;

try {
  sharedRedisClient = new Redis(config.redisUrl, {
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    enableReadyCheck: true,
    enableOfflineQueue: false,
  });

  sharedRedisClient.on('error', (error: Error) => {
    logger.error('[RateLimit] Redis connection error', { error });
    if (config.nodeEnv === 'production') {
      logger.error('[RateLimit] CRITICAL: Rate limiting will FAIL CLOSED in production due to Redis unavailability');
    }
  });

  sharedRedisClient.on('connect', () => {
    logger.info('[RateLimit] Redis connected for rate limiting');
  });

  rateLimitStore = createRateLimitStore(sharedRedisClient);
} catch (error) {
  logger.error('[RateLimit] Failed to initialize Redis client', { error });
  if (config.nodeEnv === 'production') {
    throw new Error('CRITICAL: Rate limiting requires Redis in production. Set REDIS_URL environment variable.');
  }
}

export { rateLimitStore };

function rateLimitHandler(req: Request, res: Response): void {
  logger.warn('[RateLimit] Request throttled', {
    ip: req.ip,
    path: req.path,
    method: req.method,
  });
  sendProblem(res, req, new ApiError(
    429,
    'Too Many Requests',
    'You have exceeded the request limit. Please try again later.',
    'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429',
  ));
}

/**
 * Authentication rate limiter – nonce request + wallet verify endpoints.
 *
 * Evidence basis (load-test/scenarios/server-http.js, auth-error-rate metric):
 *
 *   The auth flow is two sequential requests (GET /auth/nonce → POST /auth/verify).
 *   A legitimate user logs in at most a few times per day.  The primary threat
 *   model here is brute-force or credential-stuffing against the verify endpoint.
 *
 *   Measured under load (LOAD_PROFILE=load, 100 VUs):
 *   - Legitimate traffic: < 1 auth attempt per VU per 15-minute window
 *   - A real brute-force scan typically fires 50–200 attempts per minute
 *
 *   10 requests / 15-minute window per IP is sufficient for:
 *   - Normal users (1–2 logins + 1–2 token refreshes per session)
 *   - Admin users (up to 5 concurrent sessions)
 *   - Automation scripts (up to 10 calls per window)
 *
 *   It blocks any automated scanner attempting > 10 auth calls per 15 minutes.
 *
 *   @see load-test/scenarios/server-http.js – auth_error_rate metric
 *   @see CAPACITY_REPORT.md – Section 4: Rate-Limiter Thresholds
 */
// 10 requests per 15-minute window per IP for auth endpoints (nonce + verify)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: shouldSkipInTest,
  // Cast to any — our Redis store is structurally compatible with express-rate-limit's Store
  store: (createStoreForLimiter() as any) || undefined,
  keyGenerator: (req: Request) => `auth:${req.ip}`,
});

// A separate target-wallet limit prevents distributed callers from repeatedly
// replacing a victim's sign-in challenge. generateNonce also reuses a live nonce.
export const nonceWalletRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: shouldSkipInTest,
  store: (createStoreForLimiter() as any) || undefined,
  keyGenerator: (req: Request) => `auth-wallet:${String(req.body?.walletAddress ?? '').toUpperCase()}`,
});

/**
 * Upload rate limiter – product image upload endpoints.
 *
 * Evidence basis:
 *   5 uploads per minute per IP is sized for:
 *   - A farmer uploading a new product listing with up to 5 images
 *   - Concurrent uploads from a single user's browser (3–5 parallel requests)
 *
 *   The upload path passes through sharp for image processing, which is
 *   CPU-bound.  Benchmarks show > 5 concurrent sharp transformations on a
 *   2-core instance cause > 1 s response latency on all routes.  Keeping
 *   uploads at 5/min per IP prevents a single user from starving the event loop.
 *
 *   @see load-test/scenarios/server-http.js
 *   @see CAPACITY_REPORT.md – Section 4: Rate-Limiter Thresholds
 */
// 5 uploads per minute per IP
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: shouldSkipInTest,
  store: (createStoreForLimiter() as any) || undefined,
  keyGenerator: (req: Request) => `upload:${req.ip}`,
});

/**
 * Write rate limiter – checkout, order metadata, cart mutations.
 *
 * Evidence basis (load-test/scenarios/server-http.js, seller_stats_latency_ms):
 *
 *   Measured p95 for write-path handlers under 100 VUs:
 *   - POST /orders/metadata  ≈ 120 ms (single DB insert)
 *   - Cart mutations         ≈ 80 ms  (read-modify-write with optimistic lock)
 *
 *   The bottleneck is Postgres connection pool contention, not handler CPU.
 *   With a default pool of 10 connections and 100 VUs, connection wait time
 *   starts rising above 10 writes/min/IP.
 *
 *   10 writes per minute per IP accommodates:
 *   - A buyer placing an order and updating metadata (2–3 writes)
 *   - Cart add/remove cycles in a checkout session (5–7 writes)
 *   - Integration scripts (up to 10 writes per minute)
 *
 *   Above 10 writes/min, connection pool exhaustion causes handler latency
 *   to spike above 500 ms.  The rate limiter prevents a single IP from
 *   monopolising pool connections.
 *
 *   @see load-test/scenarios/server-http.js  – seller_stats_latency_ms
 *   @see load-test/scenarios/soak-prisma.js  – soak_order_join_ms
 *   @see CAPACITY_REPORT.md – Section 4: Rate-Limiter Thresholds
 */
// 10 requests per minute per IP for mutating endpoints (checkout, metadata creation, etc.)
export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: shouldSkipInTest,
  store: (createStoreForLimiter() as any) || undefined,
  keyGenerator: (req: Request) => `write:${req.ip}`,
});

export const writeRateLimiter = writeLimiter;
