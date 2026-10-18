import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import logger from '../config/logger.js';
import { problemDetail } from './errors.js';
import type { WalletRequest } from './walletAuth.js';
import {
  getIdempotencyStore,
  type IdempotencyStoreEntry,
} from './idempotencyStore.js';

const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';
/** How long a completed response stays replayable. */
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours
/**
 * Namespace version. Entries written before issue #1208 were keyed on the raw
 * header alone and are not reachable through the scoped keys below.
 */
const CACHE_KEY_PREFIX = 'idem:v2';

export function requireIdempotencyKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const key = req.headers[IDEMPOTENCY_KEY_HEADER];
  if (!key || typeof key !== 'string' || !key.trim()) {
    res.status(400).json({ error: 'X-Idempotency-Key header is required' });
    return;
  }
  (req as Request & { idempotencyKey?: string }).idempotencyKey = key;
  next();
}

/** Method + path of the request, so the same key on two routes cannot collide. */
function routeScope(req: Request): string {
  const rawUrl = (req.originalUrl || req.url || req.path || '').split('?')[0];
  return `${(req.method || 'GET').toUpperCase()} ${rawUrl}`;
}

function idempotencyKeyOf(req: Request): string | undefined {
  return (req as Request & { idempotencyKey?: string }).idempotencyKey;
}

/**
 * Scoped cache key: `<method> <path>:<wallet>:<header key>`.
 *
 * The wallet comes from the verified session (`requireWallet` runs first), so a
 * key reused by a different wallet — or on a different route — can never reach
 * another tenant's cached response. Returns `null` when there is no verified
 * wallet, in which case nothing is cached or replayed.
 */
export function idempotencyCacheKey(req: Request): string | null {
  const key = idempotencyKeyOf(req);
  const walletAddress = (req as WalletRequest).walletAddress;
  if (!key || !walletAddress) return null;
  return `${CACHE_KEY_PREFIX}:${routeScope(req)}:${walletAddress}:${key}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    );
  return `{${entries.join(',')}}`;
}

/** sha256 of method + path + body: identifies "the same request" for a key. */
export function requestFingerprint(req: Request): string {
  let body = '';
  if (req.body !== undefined && req.body !== null) {
    try {
      body =
        typeof req.body === 'string' ? req.body : stableStringify(req.body);
    } catch {
      body = String(req.body);
    }
  }
  return crypto
    .createHash('sha256')
    .update(`${routeScope(req)}:${body}`)
    .digest('hex');
}

/**
 * Replays a cached response when the caller repeats a request.
 *
 * Returns `true` when a response has already been written (cache hit, or 409
 * because the key was reused with a different body) and the handler must stop;
 * `false` when the request should run normally. Store failures fail open so a
 * cache outage never breaks order/campaign creation.
 */
export async function replayCachedResponse(
  req: Request,
  res: Response,
): Promise<boolean> {
  const cacheKey = idempotencyCacheKey(req);
  if (!cacheKey) return false;

  let cached: IdempotencyStoreEntry | null;
  try {
    cached = await getIdempotencyStore().get(cacheKey);
  } catch (error) {
    logger.warn('[Idempotency] Cache lookup failed; treating as a miss', {
      error,
    });
    return false;
  }
  if (!cached) return false;

  if (cached.fingerprint && cached.fingerprint !== requestFingerprint(req)) {
    problemDetail(
      res,
      req,
      409,
      'Idempotency Key Reused',
      'X-Idempotency-Key was already used with a different request body',
    );
    return true;
  }

  res.status(cached.status).json(cached.body);
  return true;
}

/** Caches a completed response for the caller's own key. */
export async function setCachedResponse(
  req: Request,
  status: number,
  body: unknown,
): Promise<void> {
  const cacheKey = idempotencyCacheKey(req);
  if (!cacheKey) return;

  try {
    await getIdempotencyStore().set(
      cacheKey,
      { status, body, fingerprint: requestFingerprint(req) },
      CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn('[Idempotency] Failed to cache response', { error });
  }
}

/** Drops the entry for this caller's key (used when a handler rolls back). */
export async function clearIdempotencyCache(req: Request): Promise<void> {
  const cacheKey = idempotencyCacheKey(req);
  if (!cacheKey) return;
  try {
    await getIdempotencyStore().delete(cacheKey);
  } catch (error) {
    logger.warn('[Idempotency] Failed to clear cached response', { error });
  }
}

export { CACHE_TTL_SECONDS };
